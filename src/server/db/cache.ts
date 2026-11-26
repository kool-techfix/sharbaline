/** A cached database client and the schema fingerprint of the generated client that built it. */
export interface CachedClient<T extends { $disconnect(): Promise<void> }> {
  client: T;
  schema: string;
}

/**
 * Keeps the cached client while the generated client's schema is unchanged; otherwise builds a
 * new one and closes the old pool. Compared by schema, not by class: Next.js bundles the
 * generated client once per server layer (pages, server actions), so the class differs between
 * layers even in production, and comparing classes made the layers keep replacing each
 * other's client and closing pools that requests were still using (D-034).
 */
export function currentClient<T extends { $disconnect(): Promise<void> }>(
  cached: CachedClient<T> | undefined,
  schema: string,
  create: () => T,
): CachedClient<T> {
  if (cached && cached.schema === schema) return cached;
  // Requests still running on the old client may fail; that only happens in dev, right after a
  // schema change, and those requests would have failed against the new tables anyway.
  cached?.client.$disconnect().catch(() => undefined);
  return { client: create(), schema };
}

/**
 * A fingerprint of the generated client's schema: every model with its fields, and every enum
 * with its values. The same in every bundle; different after `prisma generate` on a changed schema.
 */
export function schemaFingerprint(prismaNamespace: object, enums: object): string {
  const parts = Object.entries({ ...prismaNamespace, ...enums })
    .filter(([name, value]) => (name === "ModelName" || name.endsWith("ScalarFieldEnum") || name in enums) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${JSON.stringify(value)}`);
  return parts.join("|");
}
