/**
 * Name normalisation for search and duplicate checks: lower case, diacritics removed (so
 * "Adébáyọ̀" matches "Adebayo"), punctuation dropped, spaces collapsed. Display always uses the
 * name as entered.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The searchable form of a patient's full name, in a fixed order. */
export function nameSearchKey(parts: { surname: string; firstName: string; otherNames?: string | null }): string {
  return normalizeName([parts.surname, parts.firstName, parts.otherNames ?? ""].join(" "));
}

/** Trigrams as pg_trgm builds them: each word padded with two spaces before and one after. */
function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalizeName(text).split(" ").filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** pg_trgm-style similarity (shared trigrams / all trigrams), 0..1. Word order doesn't matter. */
export function nameSimilarity(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return shared / (ga.size + gb.size - shared);
}
