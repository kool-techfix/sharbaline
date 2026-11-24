import type { ReactNode } from "react";
import { Stethoscope } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * Centred card for sign-in screens (layout from Login-Verification-Desktop.png): status chip at
 * the top right, logo placeholder, hospital name, "Staff portal", the screen, then the footer.
 */
export function BrandCard({
  hospitalName,
  status,
  children,
}: {
  hospitalName: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <div className="flex justify-end">{status}</div>
      <div className="flex flex-1 items-center justify-center py-8">
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
      </div>
      <footer className="text-center text-sm text-muted">{t("app.footer")}</footer>
    </div>
  );
}
