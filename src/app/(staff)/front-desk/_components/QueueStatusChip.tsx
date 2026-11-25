import { CheckCircle2, Clock, LogOut, Stethoscope } from "lucide-react";
import { StatusChip, type StatusTone } from "@/components/StatusChip";
import { t } from "@/lib/i18n";
import type { QueueItem } from "@/server/services/queue/queue";

type QueueStatus = QueueItem["status"];

const LOOK: Record<QueueStatus, { tone: StatusTone; icon: typeof Clock }> = {
  waiting: { tone: "info", icon: Clock },
  with_nurse: { tone: "info", icon: Stethoscope },
  waiting_doctor: { tone: "info", icon: Clock },
  with_doctor: { tone: "info", icon: Stethoscope },
  done: { tone: "success", icon: CheckCircle2 },
  left: { tone: "neutral", icon: LogOut },
};

/** Queue status as text plus icon, never colour alone. */
export function QueueStatusChip({ status }: { status: string }) {
  const known = (status in LOOK ? status : "waiting") as QueueStatus;
  return (
    <StatusChip tone={LOOK[known].tone} icon={LOOK[known].icon}>
      {t(`queue.status.${known}`)}
    </StatusChip>
  );
}
