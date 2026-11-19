import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types.js";

export interface VerifyWebhookOptions {
  /** Reject events older than this many milliseconds. Default 5 minutes. Set 0 to disable. */
  toleranceMs?: number;
  /** Override the current time (ms), for testing. */
  now?: number;
}

type HeaderBag =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? bag[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Computes the `sha256=<hex>` signature Stager AI sends in X-Stager-Signature. */
export function signWebhook(rawBody: string | Uint8Array, timestamp: string, secret: string): string {
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Checks the X-Stager-Signature header of a webhook request.
 * Pass the raw request body exactly as received, before JSON parsing.
 */
export function isValidWebhookSignature(
  rawBody: string | Uint8Array,
  headers: HeaderBag,
  secret: string,
  options: VerifyWebhookOptions = {}
): boolean {
  const signature = header(headers, "x-stager-signature");
  const timestamp = header(headers, "x-stager-timestamp");
  if (!signature || !timestamp) return false;

  const tolerance = options.toleranceMs ?? 5 * 60 * 1000;
  if (tolerance > 0) {
    const sentAt = Number(timestamp);
    const now = options.now ?? Date.now();
    if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > tolerance) return false;
  }

  const expected = Buffer.from(signWebhook(rawBody, timestamp, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Verifies the signature and returns the parsed event.
 * Throws if the signature is missing, wrong or too old.
 */
export function constructWebhookEvent(
  rawBody: string | Uint8Array,
  headers: HeaderBag,
  secret: string,
  options?: VerifyWebhookOptions
): WebhookEvent {
  if (!isValidWebhookSignature(rawBody, headers, secret, options)) {
    throw new Error("Invalid Stager AI webhook signature");
  }
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  return JSON.parse(body) as WebhookEvent;
}
