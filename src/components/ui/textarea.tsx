import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Multi-line companion to Input: same border, text size and invalid state. */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-2 aria-invalid:border-danger-text",
        className,
      )}
      {...props}
    />
  );
}
