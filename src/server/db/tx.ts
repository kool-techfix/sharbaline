import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "./client";

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` in one READ COMMITTED transaction. READ COMMITTED is required: the audit hash
 * chain trigger rejects other isolation levels (D-018). Concurrency rules such as stock
 * never going negative use explicit row locks (SELECT … FOR UPDATE), not SERIALIZABLE.
 */
export function withTransaction<T>(
  database: Db,
  fn: (tx: Tx) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return database.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: options.timeoutMs ?? 10_000,
  });
}
