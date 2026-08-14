import { NextResponse } from "next/server";

import { auth } from "@/auth";

const PUBLIC_PATHS = [
  "/login",
  "/invitations/accept",
  "/api/health",
  "/manifest.webmanifest"
];
const PUBLIC_PREFIXES = ["/api/auth", "/icons/"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth?.user);
  const isSuspended = request.auth?.user?.accessStatus === "SUSPENDED";

  if (isSuspended) {
    return NextResponse.redirect(new URL("/login?status=accountSuspended", nextUrl));
  }

  if (isPublicPath(nextUrl.pathname)) {
    if (isLoggedIn && nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", nextUrl));
    }

    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    const callbackUrl = `${nextUrl.pathname}${nextUrl.search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]
};
