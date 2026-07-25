import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isPublicDemoPath, REQUEST_PATHNAME_HEADER } from "@/lib/public-demo";

const PUBLIC_PATHS = ["/login", "/invitations/accept", "/api/health"];
const PUBLIC_PREFIXES = ["/api/auth"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    isPublicDemoPath(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    /^\/api\/hamsters\/[^/]+\/image$/.test(pathname)
  );
}

function nextWithPathname(request: { headers: Headers; nextUrl: { pathname: string } }) {
  const requestHeaders = new Headers(request.headers);
  // RootLayoutがデモ経路で認証済みHousehold情報を取得しないよう、信頼できる実パスで上書きする。
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth?.user);
  const isSuspended = request.auth?.user?.accessStatus === "SUSPENDED";

  // デモはログイン状態に依存しない。停止中セッションが残っていてもサンプルだけを表示する。
  if (isPublicDemoPath(nextUrl.pathname)) {
    return nextWithPathname(request);
  }

  if (isSuspended) {
    return NextResponse.redirect(new URL("/login?status=accountSuspended", nextUrl));
  }

  if (isPublicPath(nextUrl.pathname)) {
    if (isLoggedIn && nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", nextUrl));
    }

    return nextWithPathname(request);
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    const callbackUrl = `${nextUrl.pathname}${nextUrl.search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  return nextWithPathname(request);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]
};
