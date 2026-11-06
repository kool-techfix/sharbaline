import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 16px text (no zoom-on-focus on tablets), 44px tall, 3:1 border (WCAG 1.4.11). */
export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-2 aria-invalid:border-danger-text",
        className,
      )}
      {...props}
    />
  );
}
