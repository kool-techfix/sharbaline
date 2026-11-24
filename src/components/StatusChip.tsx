import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<StatusTone, string> = {
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
  info: "bg-info-bg text-info-text",
  neutral: "bg-neutral-bg text-neutral-text",
};

export interface StatusChipProps {
  tone: StatusTone;
  /** Always required: status is never conveyed by colour alone. */
  children: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatusChip({ tone, children, icon: Icon, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      {children}
    </span>
  );
}
