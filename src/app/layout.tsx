import type { Metadata, Viewport } from "next";
import "driver.js/dist/driver.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dog & Cat Manager",
  description: "犬と猫の情報を管理するWebアプリ",
  applicationName: "Dog & Cat Manager",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Dog & Cat Manager",
    statusBarStyle: "default"
  },
  icons: {
    apple: "/apple-icon.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3E6F8E"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
