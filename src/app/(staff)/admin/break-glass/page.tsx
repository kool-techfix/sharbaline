import Link from "next/link";
import { CheckCircle2, Clock, ShieldAlert, ShieldX, TriangleAlert } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { t, tPlural } from "@/lib/i18n";
import { formatHospitalDate, formatHospitalTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { listBreakGlass, type BreakGlassListItem, type ReviewOutcome } from "@/server/services/break-glass/break-glass";
import { displayName } from "../../_components/patients/format";
import { ReviewForm } from "./_components/ReviewForm";

export const dynamic = "force-dynamic";

const OUTCOME_CHIP: Record<ReviewOutcome, { tone: "success" | "danger" | "warning"; icon: typeof CheckCircle2 }> = {
  appropriate: { tone: "success", icon: CheckCircle2 },
  inappropriate: { tone: "danger", icon: ShieldX },
  needs_follow_up: { tone: "warning", icon: TriangleAlert },
};

/**
 * Break-glass reviews (D-035). The tab is in the URL (?status=reviewed); nothing about any
 * patient is. Reviewers see the reason text, which no log or audit entry holds.
 */
export default async function BreakGlassReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireRole("admin");
  const { status: raw } = await searchParams;
  const status = raw === "reviewed" ? "reviewed" : "awaiting";
  const outcome = await listBreakGlass(await requestContext(actorOf(session)), { status });
  const items = outcome.ok ? outcome.value.items : [];

  return (
    <section aria-labelledby="bg-title" className="space-y-6">
      <div>
        <h1 id="bg-title" className="text-3xl font-bold">
          {t("breakGlass.list.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-muted">{t("breakGlass.list.intro")}</p>
      </div>

      <nav aria-label={t("breakGlass.list.tabs")} className="flex flex-wrap gap-2">
        {(["awaiting", "reviewed"] as const).map((tab) => (
          <Link
            key={tab}
            href={tab === "awaiting" ? "/admin/break-glass" : "/admin/break-glass?status=reviewed"}
            aria-current={tab === status ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md border px-4 font-semibold",
              tab === status ? "border-primary bg-primary-soft text-primary" : "border-border-strong text-text hover:bg-primary-soft",
            )}
          >
            {t(`breakGlass.list.${tab}`)}
            {tab === "awaiting" && outcome.ok ? ` (${outcome.value.awaitingCount})` : null}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p>{status === "awaiting" ? t("breakGlass.list.noneAwaiting") : t("breakGlass.list.noneReviewed")}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id}>
              <EventCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {outcome.ok && outcome.value.truncated ? <p className="text-muted">{t("breakGlass.list.truncated")}</p> : null}
    </section>
  );
}

function accessLine(item: BreakGlassListItem, now: Date): { text: string; live: boolean } {
  if (item.endedAt) return { text: t("breakGlass.item.endedEarly", { time: formatHospitalTime(item.endedAt) }), live: false };
  if (item.expiresAt > now) return { text: t("breakGlass.item.openNow", { time: formatHospitalTime(item.expiresAt) }), live: true };
  return { text: t("breakGlass.item.expired", { time: formatHospitalTime(item.expiresAt) }), live: false };
}

function EventCard({ item }: { item: BreakGlassListItem }) {
  const patient = `${displayName(item.patient)} (${item.patient.patientNumber})`;
  const who = item.user?.displayName ?? t("breakGlass.item.unknownUser");
  const access = accessLine(item, new Date());
  const titleId = `bg-${item.id}`;

  return (
    <article aria-labelledby={titleId} className="space-y-4 rounded-md border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={titleId} className="text-xl font-bold">
          {t("breakGlass.item.title", { name: who, patient })}
        </h2>
        {access.live ? (
          <StatusChip tone="warning" icon={ShieldAlert}>
            {access.text}
          </StatusChip>
        ) : null}
      </div>
      <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-muted">{t("breakGlass.item.when")}</dt>
          <dd>
            {formatHospitalDate(item.startedAt)}, {formatHospitalTime(item.startedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">{t("breakGlass.item.access")}</dt>
          <dd className="flex items-center gap-2">
            <Clock aria-hidden="true" className="size-4 shrink-0" />
            {access.text} · {tPlural("breakGlass.item.views", item.accessCount)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">{t("breakGlass.item.reason")}</dt>
          <dd>{t(`breakGlass.reason.${item.reasonCategory}`)}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-sm font-semibold text-muted">{t("breakGlass.item.details")}</dt>
          <dd className="whitespace-pre-line">{item.reasonDetails}</dd>
        </div>
      </dl>
      <p>
        <Link
          href={`/admin/patients/${item.patient.id}`}
          className="inline-flex min-h-11 items-center font-semibold text-primary underline"
        >
          {t("breakGlass.item.patientLink", { patient })}
        </Link>
      </p>

      {item.review ? (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="flex flex-wrap items-center gap-3">
            <StatusChip tone={OUTCOME_CHIP[item.review.outcome].tone} icon={OUTCOME_CHIP[item.review.outcome].icon}>
              {t(`breakGlass.outcome.${item.review.outcome}`)}
            </StatusChip>
            <span className="text-muted">
              {t("breakGlass.item.reviewedBy", {
                name: item.review.reviewer?.displayName ?? t("breakGlass.item.unknownUser"),
                date: formatHospitalDate(item.review.reviewedAt),
              })}
            </span>
          </p>
          {item.review.comment ? <p className="whitespace-pre-line">{item.review.comment}</p> : null}
        </div>
      ) : item.canReview ? (
        <div className="border-t border-border pt-4">
          <ReviewForm eventId={item.id} />
        </div>
      ) : (
        <p className="border-t border-border pt-4 font-semibold text-muted">{t("breakGlass.item.selfReview")}</p>
      )}
    </article>
  );
}
