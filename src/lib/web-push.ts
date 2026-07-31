import webPush from "web-push";
import { z } from "zod";

const VAPID_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MAX_PUSH_REQUEST_BYTES = 16_384;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => value.startsWith("https://")),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(16).max(512).regex(VAPID_KEY_PATTERN),
    auth: z.string().min(8).max(512).regex(VAPID_KEY_PATTERN)
  })
});

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export class WebPushConfigurationError extends Error {
  constructor() {
    super("Web PushのVAPID環境変数が設定されていません。");
    this.name = "WebPushConfigurationError";
  }
}

export function getPublicVapidConfiguration() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() ?? "";
  const valid =
    publicKey.length >= 32 &&
    privateKey.length >= 32 &&
    VAPID_KEY_PATTERN.test(publicKey) &&
    VAPID_KEY_PATTERN.test(privateKey) &&
    (/^mailto:[^\s@]+@[^\s@]+$/.test(subject) || /^https:\/\/[^\s]+$/.test(subject));
  return { configured: valid, publicKey: valid ? publicKey : null };
}

export function configureWebPush() {
  const configuration = getPublicVapidConfiguration();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!configuration.configured || !configuration.publicKey || !privateKey || !subject) {
    throw new WebPushConfigurationError();
  }
  webPush.setVapidDetails(subject, configuration.publicKey, privateKey);
}

export async function sendCareWebPush(
  subscription: StoredPushSubscription,
  payload: { title: string; body: string }
) {
  return webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: "/icons/pwa-192.png",
      badge: "/icons/pwa-192.png",
      data: { url: "/" }
    }),
    { TTL: 60 * 60, urgency: "normal", timeout: 10_000 }
  );
}

export function isInvalidPushSubscriptionError(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

export function isSameOriginMutationRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requestBodyIsWithinLimit(request: Request) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return true;
  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length >= 0 && length <= MAX_PUSH_REQUEST_BYTES;
}
