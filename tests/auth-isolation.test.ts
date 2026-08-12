import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDogCatAuthCookieConfig } from "../src/lib/auth-cookies";

const expectedCookieKeys = [
  "callbackUrl",
  "csrfToken",
  "nonce",
  "pkceCodeVerifier",
  "sessionToken",
  "state",
  "webauthnChallenge"
] as const;

test("HTTP開発環境ではAuth.js CookieをDog-Cat専用の非Secure名に分離する", () => {
  const config = createDogCatAuthCookieConfig("http://localhost:3002");
  assert.equal(config.useSecureCookies, false);
  assert.deepEqual(Object.keys(config.cookies).sort(), [...expectedCookieKeys]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(config.cookies).map(([key, cookie]) => [key, cookie.name])),
    {
      sessionToken: "dog-cat-manager.authjs.session-token",
      callbackUrl: "dog-cat-manager.authjs.callback-url",
      csrfToken: "dog-cat-manager.authjs.csrf-token",
      pkceCodeVerifier: "dog-cat-manager.authjs.pkce.code_verifier",
      state: "dog-cat-manager.authjs.state",
      nonce: "dog-cat-manager.authjs.nonce",
      webauthnChallenge: "dog-cat-manager.authjs.challenge"
    }
  );
  for (const cookie of Object.values(config.cookies)) {
    assert.deepEqual(Object.keys(cookie), ["name"]);
    assert.match(cookie.name, /^dog-cat-manager\.authjs\./);
  }
});

test("HTTPS環境ではCSRFだけ__Host-、他のAuth.js Cookieは__Secure-を使用する", () => {
  const config = createDogCatAuthCookieConfig("https://pets.example.com");
  assert.equal(config.useSecureCookies, true);
  assert.equal(
    config.cookies.csrfToken.name,
    "__Host-dog-cat-manager.authjs.csrf-token"
  );

  for (const key of expectedCookieKeys.filter((key) => key !== "csrfToken")) {
    assert.match(config.cookies[key].name, /^__Secure-dog-cat-manager\.authjs\./);
  }
});

test("Auth.jsはdatabase sessionとDog-Cat専用Cookie設定を維持する", async () => {
  const authSource = await readFile("src/auth.ts", "utf8");
  const authContextSource = await readFile("src/lib/auth-context.ts", "utf8");

  assert.match(authSource, /strategy:\s*"database"/);
  assert.match(authSource, /createDogCatAuthCookieConfig\(\)/);
  assert.match(authSource, /\.\.\.authCookieConfig/);
  assert.doesNotMatch(authContextSource, /\["authjs\.session-token"/);
  assert.match(authContextSource, /DOG_CAT_AUTH_SESSION_COOKIE_NAMES/);
});

test("開発URLとDocker公開ポートを3002へ分離し、コンテナ内部は3000を維持する", async () => {
  const [envExample, developmentEnvExample, productionEnvExample, compose, startDev, membersPage] =
    await Promise.all([
      readFile(".env.example", "utf8"),
      readFile(".env.development.example", "utf8"),
      readFile(".env.production.example", "utf8"),
      readFile("docker-compose.yml", "utf8"),
      readFile("start-dev.ps1", "utf8"),
      readFile("src/app/(app)/settings/members/page.tsx", "utf8")
    ]);

  assert.match(envExample, /^AUTH_URL="http:\/\/localhost:3002"$/m);
  assert.match(developmentEnvExample, /^AUTH_URL="http:\/\/localhost:3002"$/m);
  assert.doesNotMatch(productionEnvExample, /localhost/);
  assert.match(compose, /"127\.0\.0\.1:3002:3000"/);
  assert.doesNotMatch(compose, /"127\.0\.0\.1:3001:3000"/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health'/);
  assert.match(startDev, /Start-Process "http:\/\/localhost:3002"/);
  assert.match(membersPage, /"http:\/\/localhost:3002"/);
});
