import type { NextAuthConfig } from "next-auth";

const DOG_CAT_AUTH_COOKIE_BASE = "dog-cat-manager.authjs";

export const DOG_CAT_AUTH_SESSION_COOKIE_NAMES = [
  `${DOG_CAT_AUTH_COOKIE_BASE}.session-token`,
  `__Secure-${DOG_CAT_AUTH_COOKIE_BASE}.session-token`
] as const;

/**
 * Auth.jsの既定Cookie属性を維持しつつ、localhostで併用する別サービスとCookie名を分離する。
 * カスタム名を使うとsecure prefixも自動では付かないため、AUTH_URLのschemeと同じ条件で明示する。
 */
export function createDogCatAuthCookieConfig(
  authUrl: string | undefined = process.env.AUTH_URL
) {
  let useSecureCookies = false;

  if (authUrl) {
    try {
      useSecureCookies = new URL(authUrl).protocol === "https:";
    } catch {
      // 不正なAUTH_URLはHTTP開発環境相当とし、Auth.js本体の設定検証に委ねる。
    }
  }

  const securePrefix = useSecureCookies ? "__Secure-" : "";
  const hostPrefix = useSecureCookies ? "__Host-" : "";

  return {
    useSecureCookies,
    // optionsを上書きしないことで、現在のAuth.js既定のHttpOnly・SameSite・maxAge等を維持する。
    cookies: {
      sessionToken: { name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.session-token` },
      callbackUrl: { name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.callback-url` },
      csrfToken: { name: `${hostPrefix}${DOG_CAT_AUTH_COOKIE_BASE}.csrf-token` },
      pkceCodeVerifier: {
        name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.pkce.code_verifier`
      },
      state: { name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.state` },
      nonce: { name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.nonce` },
      webauthnChallenge: { name: `${securePrefix}${DOG_CAT_AUTH_COOKIE_BASE}.challenge` }
    }
  } satisfies Pick<NextAuthConfig, "cookies" | "useSecureCookies">;
}
