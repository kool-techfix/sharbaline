import en from "@/messages/en.json";

/**
 * All user-facing text comes from src/messages (CLAUDE.md: strings stay translatable).
 * English only for now; the shape allows adding Hausa, Yoruba, Igbo or Pidgin catalogues later.
 * Plural forms use keys suffixed with "#one", "#other", … (Intl.PluralRules categories).
 */
type Catalogue = typeof en;
type AllKeys = keyof Catalogue & string;

export type MessageKey = Exclude<AllKeys, `${string}#${string}`>;
export type PluralKey = AllKeys extends infer K
  ? K extends `${infer Base}#other`
    ? Base
    : never
  : never;

type Vars = Record<string, string | number>;

const catalogue: Record<string, string> = en;
const locale = "en";
const pluralRules = new Intl.PluralRules(locale);

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(catalogue[key] ?? key, vars);
}

export function tPlural(key: PluralKey, count: number, vars?: Vars): string {
  const form = catalogue[`${key}#${pluralRules.select(count)}`] ?? catalogue[`${key}#other`] ?? key;
  return interpolate(form, { count, ...vars });
}
