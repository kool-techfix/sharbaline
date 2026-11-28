"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Large radio buttons in a fieldset: no typing, arrow keys move between them. */
export function RadioCards({
  name,
  legend,
  value,
  options,
  error,
  onChange,
}: {
  name: string;
  legend: string;
  value: string;
  options: { value: string; label: string }[];
  error?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-base font-semibold text-heading">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <label
            key={option.value}
            htmlFor={`${name}-${option.value}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border-strong bg-surface px-4 has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              error && "border-2 border-danger-text",
            )}
          >
            <input
              id={`${name}-${option.value}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-5 accent-primary"
            />
            <span className="font-semibold">{option.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${name}-error`} message={error} />
    </fieldset>
  );
}

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-2 text-base font-semibold text-danger-text">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      {message}
    </p>
  );
}
