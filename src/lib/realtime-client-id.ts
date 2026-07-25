const REALTIME_CLIENT_STORAGE_KEY = "hamster-manager-realtime-client-id";

export function createRealtimeClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function ensureRealtimeClientId() {
  try {
    const existingClientId = window.sessionStorage.getItem(REALTIME_CLIENT_STORAGE_KEY);
    if (existingClientId) return existingClientId;
  } catch {
    // Restricted browser modes can disable sessionStorage; keep using an in-memory id.
  }

  const clientId = createRealtimeClientId();

  try {
    window.sessionStorage.setItem(REALTIME_CLIENT_STORAGE_KEY, clientId);
  } catch {
    // Restricted browser modes can disable sessionStorage; keep using the generated id.
  }

  return clientId;
}
