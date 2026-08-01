"use client";

import { useEffect } from "react";

const NOTIFICATION_CLICK_MESSAGE = "HAMSTER_CARE_NOTIFICATION_CLICK";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function handleServiceWorkerMessage(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;

      const message = event.data as { type?: unknown; url?: unknown };
      if (message.type !== NOTIFICATION_CLICK_MESSAGE || message.url !== "/") return;

      if (window.location.pathname !== "/" || window.location.search || window.location.hash) {
        window.location.assign("/");
      }
    }

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // UI側でready失敗として案内する。ブラウザー例外やURLはログへ出さない。
    });

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);
  return null;
}
