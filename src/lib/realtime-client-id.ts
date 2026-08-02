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
    // 制限付きブラウザーでsessionStorageが無効でも、メモリ上のIDで同一画面の自己更新抑止を続ける。
  }

  const clientId = createRealtimeClientId();

  try {
    window.sessionStorage.setItem(REALTIME_CLIENT_STORAGE_KEY, clientId);
  } catch {
    // 保存できない環境でも生成済みIDは利用できるため、同期機能全体は失敗扱いにしない。
  }

  return clientId;
}
