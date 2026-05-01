import { NextRequest, NextResponse } from "next/server";

import { contactSchema } from "@/lib/schemas/contact-schema";
import { persistSubmission, notifyOperator } from "@/lib/services/contact-service";

const SUCCESS_MESSAGE = "Thanks — we'll get back to you within one business day.";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // submissions per window per IP
const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  console.log(
    `[api/contact] POST — ip: ${ip}, userAgent: ${userAgent ? "present" : "absent"}`
  );

  // Defence-in-depth: refuse oversized bodies before parsing.
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_PAYLOAD_BYTES) {
    console.warn(`[api/contact] POST — payload too large from ip: ${ip}`);
    return NextResponse.json(
      { message: "Payload too large" },
      { status: 413 }
    );
  }

  if (isRateLimited(ip)) {
    console.warn(`[api/contact] POST — rate limited ip: ${ip}`);
    return NextResponse.json(
      { message: "Too many submissions — please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    console.warn(`[api/contact] POST — validation failed: ${message}`);
    return NextResponse.json({ message }, { status: 400 });
  }

  const { name, email, mobile, message, website } = parsed.data;
  const normalisedMobile = mobile && mobile.length > 0 ? mobile : null;

  // Honeypot — silently absorb. Bots that fill every field believe they
  // succeeded; humans never see the field.
  if (website && website.length > 0) {
    console.info(`[api/contact] POST — honeypot triggered, ip: ${ip}`);
    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  }

  try {
    const { id } = await persistSubmission({
      name,
      email,
      mobile: normalisedMobile,
      message,
      userAgent,
      ipAddress: ip === "unknown" ? null : ip,
    });

    const notification = await notifyOperator({
      name,
      email,
      mobile: normalisedMobile,
      message,
    });

    console.log(
      `[api/contact] POST — completed, id: ${id}, email status: ${notification.status}`
    );

    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  } catch (err) {
    console.error(
      `[api/contact] POST — server error:`,
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
    return NextResponse.json(
      { message: "We couldn't submit your message. Please try again in a moment." },
      { status: 500 }
    );
  }
}
