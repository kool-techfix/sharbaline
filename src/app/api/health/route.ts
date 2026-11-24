import { NextResponse } from "next/server";
import { internetStatus } from "@/server/system/internet-probe";

export const dynamic = "force-dynamic";

/**
 * Connection check for the status chip. Reaching this at all means the device reaches the
 * on-site server; the body says whether the server reaches the internet. No auth, no data.
 */
export async function GET() {
  const internet = await internetStatus();
  return NextResponse.json(
    { server: "ok", internet: internet.status, internetCheckedAt: internet.checkedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
