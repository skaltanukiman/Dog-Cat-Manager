import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dog & Cat Manager",
    short_name: "Dog & Cat Manager",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ja",
    background_color: "#f4f6f4",
    theme_color: "#426b5a",
    icons: [
      {
        src: "/icons/pwa-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/pwa-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
