import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * Plain, accessible data table: a real <table> with a caption and header cells, so screen
 * readers announce column names. Scrolls sideways inside its own box on narrow screens
 * instead of widening the page.
 */

export function Table({ className, children, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border bg-surface">
      <table className={cn("w-full border-collapse text-left text-base", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption className={cn("sr-only", className)} {...props} />;
}

export function TableHead(props: ComponentProps<"thead">) {
  return <thead className="border-b border-border bg-canvas" {...props} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody className="divide-y divide-border" {...props} />;
}

export function TableRow(props: ComponentProps<"tr">) {
  return <tr {...props} />;
}

export function TableHeaderCell({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("px-4 py-3 text-sm font-semibold text-heading", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
