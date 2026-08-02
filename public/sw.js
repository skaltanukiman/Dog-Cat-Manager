/* 通知専用。アプリ本体の更新を妨げないようfetchハンドラーやオフラインキャッシュは持たない。 */
const FALLBACK_TITLE = "ハムスターのお世話を確認してください";
const FALLBACK_BODY = "お世話の状況をアプリで確認してください。";
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 200;
const DASHBOARD_PATH = "/";
const NOTIFICATION_CLICK_MESSAGE = "HAMSTER_CARE_NOTIFICATION_CLICK";

function safeText(value, fallback, maxLength, preserveLineBreaks = false) {
  if (typeof value !== "string") return fallback;
  let cleaned = value.replace(/\r\n?/g, "\n");
  cleaned = preserveLineBreaks
    ? cleaned
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/\n(?:[^\S\n]*\n)+/g, "\n")
        .trim()
    : cleaned.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return fallback;
  return Array.from(cleaned).slice(0, maxLength).join("");
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  } catch {
    payload = {};
  }
  const title = safeText(payload.title, FALLBACK_TITLE, MAX_TITLE_LENGTH);
  const body = safeText(payload.body, FALLBACK_BODY, MAX_BODY_LENGTH, true);
  const icon = typeof payload.icon === "string" && payload.icon.startsWith("/icons/")
    ? payload.icon
    : "/icons/pwa-192.png";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/icons/pwa-192.png",
      data: { url: "/" },
      tag: "hamster-care-reminder"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        const targetUrl = new URL(DASHBOARD_PATH, self.location.origin).href;

        // Edgeを含む一部の環境ではWindowClient.navigate()が成功扱いでも、
        // 開いているNext.js画面へ遷移が反映されないことがある。ページ側にも
        // 同一オリジンの固定パスを通知し、location.assign()をフォールバックにする。
        existing.postMessage({ type: NOTIFICATION_CLICK_MESSAGE, url: DASHBOARD_PATH });

        try {
          if ("navigate" in existing) {
            const navigated = await existing.navigate(targetUrl);
            return (navigated ?? existing).focus();
          }
        } catch {
          // ページ側のmessageハンドラーで遷移を継続する。
        }

        return existing.focus();
      }
      return self.clients.openWindow(DASHBOARD_PATH);
    })
  );
});
