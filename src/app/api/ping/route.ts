/** Minimal liveness endpoint (load balancers, probes). No auth, no data. */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const HEAD = GET;
