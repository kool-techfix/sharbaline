import { BrandCard } from "@/components/BrandCard";
import { t } from "@/lib/i18n";
import { serverEnv } from "@/server/config/env";

// Reads the hospital name at request time, not build time.
export const dynamic = "force-dynamic";

/** Placeholder until the login slice replaces this with a redirect to /login. */
export default function HomePage() {
  return (
    <BrandCard hospitalName={serverEnv().HOSPITAL_NAME}>
      <h1 className="text-2xl font-bold">{t("home.title")}</h1>
      <p className="mt-2 text-muted">{t("home.body")}</p>
    </BrandCard>
  );
}
