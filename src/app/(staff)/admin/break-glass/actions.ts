"use server";

import { actAsCaller, type ActionResult } from "@/server/http/action-result";
import { reviewBreakGlass, type ReviewOutcome } from "@/server/services/break-glass/break-glass";

/* Public endpoint: the service checks the role, refuses self-review, validates and audits. */
export async function review(input: {
  id: string;
  eventId: string;
  outcome: ReviewOutcome;
  comment: string | null;
}): Promise<ActionResult<null>> {
  return actAsCaller((ctx) => reviewBreakGlass(ctx, input), () => null);
}
