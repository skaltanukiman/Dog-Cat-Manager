"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // UI側でready失敗として案内する。ブラウザー例外やURLはログへ出さない。
    });
  }, []);
  return null;
}
