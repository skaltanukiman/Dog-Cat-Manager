"use client";

import { useEffect } from "react";

const NOTIFICATION_CLICK_MESSAGE = "DOG_CAT_CARE_NOTIFICATION_CLICK";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function handleServiceWorkerMessage(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; url?: unknown };
      if (message.type !== NOTIFICATION_CLICK_MESSAGE || message.url !== "/care") return;
      if (window.location.pathname !== "/care" || window.location.search || window.location.hash) {
        window.location.assign("/care");
      }
    }

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // 端末設定UIがready失敗をエラー状態として案内する。
    });
    return () => navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
  }, []);
  return null;
}
