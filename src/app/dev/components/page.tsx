import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, XCircle } from "lucide-react";
import { ConnectionChip } from "@/components/ConnectionChip";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONNECTION_STATES } from "@/lib/connection";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Visual and accessibility check for shared components (the e2e suite runs axe on it).
 * Holds no data. Off unless HMS_COMPONENT_GALLERY=true.
 */
export default function ComponentGalleryPage() {
  if (process.env.HMS_COMPONENT_GALLERY !== "true") notFound();
  const sampleSync = new Date(Date.UTC(2026, 10, 6, 8, 42));

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold">{t("gallery.title")}</h1>
        <p className="mt-2 text-muted">{t("gallery.intro")}</p>
      </header>

      <section aria-labelledby="buttons" className="space-y-3">
        <h2 id="buttons" className="text-xl font-semibold">{t("gallery.buttons")}</h2>
        <div className="flex flex-wrap gap-3">
          <Button>{t("gallery.primary")}</Button>
          <Button variant="secondary">{t("gallery.secondary")}</Button>
          <Button variant="ghost">{t("gallery.ghost")}</Button>
          <Button variant="danger">{t("gallery.danger")}</Button>
          <Button disabled>{t("gallery.disabled")}</Button>
        </div>
      </section>

      <section aria-labelledby="inputs" className="max-w-md space-y-2">
        <h2 id="inputs" className="text-xl font-semibold">{t("gallery.inputs")}</h2>
        <Label htmlFor="sample-input">{t("gallery.sampleLabel")}</Label>
        <p id="sample-hint" className="text-sm text-muted">{t("gallery.sampleHint")}</p>
        <Input id="sample-input" aria-describedby="sample-hint" autoComplete="off" />
      </section>

      <section aria-labelledby="chips" className="space-y-3">
        <h2 id="chips" className="text-xl font-semibold">{t("gallery.statusChips")}</h2>
        <div className="flex flex-wrap gap-3">
          <StatusChip tone="success" icon={CheckCircle2}>{t("gallery.chipSuccess")}</StatusChip>
          <StatusChip tone="warning" icon={AlertTriangle}>{t("gallery.chipWarning")}</StatusChip>
          <StatusChip tone="danger" icon={XCircle}>{t("gallery.chipDanger")}</StatusChip>
          <StatusChip tone="info" icon={FlaskConical}>{t("gallery.chipInfo")}</StatusChip>
          <StatusChip tone="neutral" icon={Clock}>{t("gallery.chipNeutral")}</StatusChip>
        </div>
      </section>

      <section aria-labelledby="connection" className="space-y-3">
        <h2 id="connection" className="text-xl font-semibold">{t("gallery.connectionChips")}</h2>
        <div className="flex flex-col items-start gap-3">
          {CONNECTION_STATES.map((state) => (
            <ConnectionChip
              key={state}
              state={state}
              pendingCount={state === "syncing" ? 3 : 0}
              lastSyncedAt={state === "working_offline" ? sampleSync : null}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
