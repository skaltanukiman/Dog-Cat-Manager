/* Push notifications only. This worker intentionally has no fetch handler or offline cache. */
const FALLBACK_TITLE = "ハムスターのお世話を確認してください";
const FALLBACK_BODY = "お世話の状況をアプリで確認してください。";
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 200;

function safeText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
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
  const body = safeText(payload.body, FALLBACK_BODY, MAX_BODY_LENGTH);
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
        if ("navigate" in existing) await existing.navigate("/");
        return existing.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
