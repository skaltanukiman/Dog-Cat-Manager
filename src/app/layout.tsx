import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hamster Manager",
  description: "ハムスターの衛生管理と体重管理を行うWebアプリ",
  applicationName: "ハムスター管理",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ハムスター管理",
    statusBarStyle: "default"
  },
  icons: {
    apple: "/apple-icon.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#426b5a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
