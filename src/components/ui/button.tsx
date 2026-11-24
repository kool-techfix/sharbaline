import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // min-h-11 = 44px click target (WCAG 2.5.5 / CLAUDE.md UI conventions).
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary-hover",
        secondary: "border border-primary bg-surface text-primary hover:bg-primary-soft",
        ghost: "text-primary underline-offset-4 hover:bg-primary-soft hover:underline",
        danger: "bg-danger-text text-on-primary hover:opacity-90",
      },
      size: {
        default: "",
        lg: "min-h-12 px-6",
        block: "min-h-12 w-full",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
