import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  // Every Label must point at its control via htmlFor.
  return <label className={cn("block text-base font-semibold text-heading", className)} {...props} />;
}
