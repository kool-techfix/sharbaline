import type { ReactNode } from "react";
import { Stethoscope } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * The centred card used by sign-in screens (Login-Verification-Desktop.png): logo placeholder,
 * hospital name, "Staff portal", then the screen's content. Footer sits below the card.
 */
export function BrandCard({ hospitalName, children }: { hospitalName: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-between px-4 py-8">
      <div aria-hidden="true" />
      <main className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div
            role="img"
            aria-label={t("app.logoAlt")}
            className="flex size-12 items-center justify-center rounded-lg border border-dashed border-border-strong bg-primary-soft text-primary"
          >
            <Stethoscope aria-hidden="true" className="size-6" />
          </div>
          <div>
            <p className="font-semibold text-heading">{hospitalName}</p>
            <p className="text-sm text-muted">{t("app.staffPortal")}</p>
          </div>
        </div>
        {children}
      </main>
      <footer className="mt-8 text-center text-sm text-muted">{t("app.footer")}</footer>
    </div>
  );
}
