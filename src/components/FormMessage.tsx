import { AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Announced message area. Always in the DOM (empty when there's nothing to say) so screen
 * readers reliably announce changes. Errors are assertive; notices are polite. Icon + text,
 * never colour alone.
 */
export function FormMessage({
  id,
  message,
  tone = "error",
  className,
}: {
  id?: string;
  message: string | null;
  tone?: "error" | "notice";
  className?: string;
}) {
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      {message ? (
        <p
          className={cn(
            "flex items-start gap-2 rounded-md px-3 py-2 text-base",
            tone === "error" ? "bg-danger-bg text-danger-text" : "bg-info-bg text-info-text",
            className,
          )}
        >
          <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
