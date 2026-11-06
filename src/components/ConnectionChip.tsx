import { CloudOff, RefreshCw, ServerOff, Wifi, type LucideIcon } from "lucide-react";
import type { ConnectionState } from "@/lib/connection";
import { t, tPlural } from "@/lib/i18n";
import { formatHospitalTime } from "@/lib/time";
import { StatusChip, type StatusTone } from "./StatusChip";

const presentation: Record<ConnectionState, { tone: StatusTone; icon: LucideIcon }> = {
  online: { tone: "success", icon: Wifi },
  working_offline: { tone: "warning", icon: CloudOff },
  server_unreachable: { tone: "danger", icon: ServerOff },
  syncing: { tone: "info", icon: RefreshCw },
};

export interface ConnectionChipProps {
  state: ConnectionState;
  /** Queued changes; shown while syncing. */
  pendingCount?: number;
  /** Last successful cloud sync, shown beside the chip when known. */
  lastSyncedAt?: Date | null;
}

/** Presentational only; the state comes from the connection monitor (login slice / slice 8). */
export function ConnectionChip({ state, pendingCount = 0, lastSyncedAt }: ConnectionChipProps) {
  const { tone, icon } = presentation[state];
  const label =
    state === "online"
      ? t("connection.online")
      : state === "working_offline"
        ? t("connection.workingOffline")
        : state === "server_unreachable"
          ? t("connection.serverUnreachable")
          : tPlural("connection.syncing", pendingCount);

  return (
    <div role="status" aria-label={t("connection.label")} className="inline-flex items-center gap-3">
      <StatusChip tone={tone} icon={icon}>
        {label}
      </StatusChip>
      {lastSyncedAt ? (
        <span className="text-sm text-muted">
          {t("connection.lastSynced", { time: formatHospitalTime(lastSyncedAt) })}
        </span>
      ) : null}
    </div>
  );
}
