/** A cached database client and the generated client class that built it. */
export interface CachedClient<T extends { $disconnect(): Promise<void> }> {
  client: T;
  builtBy: unknown;
}

/**
 * Keeps the cached client while it was built by the current generated client class; otherwise
 * builds a new one and closes the old pool. The class changes only when `prisma generate` reruns
 * under a running dev server, so in production this always returns the cached client.
 */
export function currentClient<T extends { $disconnect(): Promise<void> }>(
  cached: CachedClient<T> | undefined,
  generatedClass: unknown,
  create: () => T,
): CachedClient<T> {
  if (cached && cached.builtBy === generatedClass) return cached;
  // Requests still running on the old client may fail; that only happens in dev, right after a
  // schema change, and those requests would have failed against the new tables anyway.
  cached?.client.$disconnect().catch(() => undefined);
  return { client: create(), builtBy: generatedClass };
}
