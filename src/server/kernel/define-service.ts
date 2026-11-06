import "server-only";
import type { z } from "zod";
import { writeAudit, type AuditEntry, type AuditMetadata } from "@/server/audit/write";
import { db as defaultDb, type Db } from "@/server/db/client";
import { withTransaction, type Tx } from "@/server/db/tx";
import { describeError, logEvent } from "@/server/log";
import { can, type Permission } from "@/server/permissions/matrix";
import type { RequestContext } from "./context";
import { ForbiddenError, ValidationError } from "./errors";
import type { Outcome } from "./outcome";

/** Explicitly public services (login, health). The reason documents why no role is needed. */
export interface PublicAccess {
  public: true;
  reason: string;
}

interface RunArgs<I> {
  tx: Tx;
  input: I;
  ctx: RequestContext;
}

export interface ServiceDefinition<S extends z.ZodType, T> {
  /** Audit action name, e.g. "users.disable". */
  action: string;
  input: S;
  permission: Permission | PublicAccess;
  /**
   * Record-level rule run inside the transaction before `run`, e.g. "own uploads only".
   * Returning false is a denial, audited as such.
   */
  authorize?: (args: RunArgs<z.output<S>>) => Promise<boolean>;
  audit: {
    resourceType: string;
    resourceId?: (input: z.output<S>, value?: T) => string | null;
    patientId?: (input: z.output<S>, value?: T) => string | null;
    metadata?: (input: z.output<S>, value?: T) => AuditMetadata;
  };
  run: (args: RunArgs<z.output<S>>) => Promise<Outcome<T>>;
}

export type Service<T> = (ctx: RequestContext, rawInput: unknown, database?: Db) => Promise<Outcome<T>>;

/**
 * The single write path (CLAUDE.md rules 4–5). Every service, read or write, goes through:
 *   1. role permission check   → denied: audit `denied`, throw ForbiddenError
 *   2. Zod validation          → invalid: audit `failure` (field names only), throw ValidationError
 *   3. one READ COMMITTED transaction: authorize → run → audit (same transaction)
 *   4. exception inside 3      → rolled back; audit `error` (or `denied`) separately; rethrow
 */
export function defineService<S extends z.ZodType, T>(def: ServiceDefinition<S, T>): Service<T> {
  const isPublic = "public" in def.permission;

  return async function service(ctx, rawInput, database = defaultDb()) {
    const base = { action: def.action, resourceType: def.audit.resourceType };

    const permitted =
      isPublic ||
      (ctx.actor.kind === "user" && can(ctx.actor.role, def.permission as Permission));
    if (!permitted) {
      await auditOutsideTransaction(database, ctx, {
        ...base,
        outcome: "denied",
        reasonCode: "role_not_permitted",
      });
      throw new ForbiddenError("role_not_permitted");
    }

    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        code: issue.code,
      }));
      await auditOutsideTransaction(database, ctx, {
        ...base,
        outcome: "failure",
        reasonCode: "invalid_input",
        metadata: { fields: [...new Set(issues.map((i) => i.path || "(root)"))].join(",") },
      });
      throw new ValidationError(issues);
    }
    const input = parsed.data;

    try {
      return await withTransaction(database, async (tx) => {
        if (def.authorize && !(await def.authorize({ tx, input, ctx }))) {
          throw new ForbiddenError("record_not_permitted");
        }
        const outcome = await def.run({ tx, input, ctx });
        const value = outcome.ok ? outcome.value : undefined;
        await writeAudit(tx, ctx, {
          ...base,
          outcome: outcome.ok ? "success" : "failure",
          reasonCode: outcome.ok ? null : outcome.reasonCode,
          resourceId: def.audit.resourceId?.(input, value) ?? null,
          patientId: def.audit.patientId?.(input, value) ?? null,
          metadata: { ...def.audit.metadata?.(input, value), ...(outcome.ok ? {} : outcome.metadata) },
        });
        return outcome;
      });
    } catch (error) {
      const denied = error instanceof ForbiddenError;
      await auditOutsideTransaction(database, ctx, {
        ...base,
        outcome: denied ? "denied" : "error",
        reasonCode: denied ? error.reasonCode : "unexpected_error",
        resourceId: safely(() => def.audit.resourceId?.(input) ?? null),
        patientId: safely(() => def.audit.patientId?.(input) ?? null),
      });
      if (!denied) {
        logEvent("error", "service.failed", {
          action: def.action,
          requestId: ctx.requestId,
          ...describeError(error),
        });
      }
      throw error;
    }
  };
}

/** Audit entries for requests that never reach (or roll back) the main transaction. */
async function auditOutsideTransaction(database: Db, ctx: RequestContext, entry: AuditEntry) {
  try {
    await writeAudit(database, ctx, entry);
  } catch (auditError) {
    // The caller still gets the original denial/error. A missing audit entry is itself
    // an incident, so make it visible in the logs.
    logEvent("error", "audit.write_failed", {
      action: entry.action,
      requestId: ctx.requestId,
      ...describeError(auditError),
    });
  }
}

function safely(fn: () => string | null): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
