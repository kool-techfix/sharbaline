"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 6-digit code entry. One real input (not six boxes): screen readers, paste, the phone's
 * one-time-code autofill and password managers all work, and the caret simply advances as
 * digits are typed. Non-digits (spaces, dashes from a pasted "123 456") are dropped, and
 * `onComplete` fires once the sixth digit arrives so nobody has to reach for the button.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  describedBy,
  invalid,
  autoFocus,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  describedBy?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <input
      ref={ref}
      id={id}
      name="code"
      value={value}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(digits);
        if (digits.length === 6 && value.length !== 6) onComplete?.(digits);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={12}
      placeholder="••••••"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cn(
        "min-h-12 w-full rounded-md border border-border-strong bg-surface px-3 text-center font-mono text-2xl tracking-[0.5em] text-text placeholder:text-muted disabled:opacity-60",
        invalid && "border-2 border-danger-text",
      )}
    />
  );
}
