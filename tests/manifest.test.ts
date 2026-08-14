import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../src/app/manifest";

test("PWA Manifest にインストール情報とアイコンを設定する", () => {
  const metadata = manifest();

  assert.deepEqual(
    {
      id: metadata.id,
      name: metadata.name,
      short_name: metadata.short_name,
      start_url: metadata.start_url,
      scope: metadata.scope,
      display: metadata.display,
      lang: metadata.lang,
      background_color: metadata.background_color,
      theme_color: metadata.theme_color
    },
    {
      id: "/",
      name: "Dog & Cat Manager",
      short_name: "Dog & Cat Manager",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "ja",
      background_color: "#F5F7FA",
      theme_color: "#3E6F8E"
    }
  );
  assert.deepEqual(metadata.icons, [
    { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icons/pwa-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    }
  ]);
});
