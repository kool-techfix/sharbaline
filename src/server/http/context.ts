import "server-only";
import { headers } from "next/headers";
import { uuidv7 } from "@/lib/ids";
import { serverEnv } from "@/server/config/env";
import type { Actor, RequestContext } from "@/server/kernel/context";
import { clientIpFrom } from "./client-ip";
import { deviceIdFromCookie } from "./cookies";

/** Request facts for services and audit: opaque request ID, client IP, device. */
export async function requestContext(actor: Actor = { kind: "anonymous" }): Promise<RequestContext> {
  const h = await headers();
  return {
    actor,
    requestId: uuidv7(),
    ip: clientIpFrom(h.get("x-forwarded-for"), serverEnv().TRUST_PROXY_HEADERS),
    deviceId: await deviceIdFromCookie(),
  };
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent")?.slice(0, 500) ?? null;
}
