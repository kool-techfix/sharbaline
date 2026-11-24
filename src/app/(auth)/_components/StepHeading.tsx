"use client";

import { forwardRef } from "react";

/** Step label ("2 · Step 2 of 2 · Identity check") and the focus target when a step appears. */
export const StepHeading = forwardRef<
  HTMLHeadingElement,
  { step?: { number: number; label: string }; title: string; intro?: string }
>(function StepHeading({ step, title, intro }, ref) {
  return (
    <div className="mb-6">
      {step ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary"
          >
            {step.number}
          </span>
          {step.label}
        </p>
      ) : null}
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-bold outline-none focus-visible:outline-3">
        {title}
      </h1>
      {intro ? <p className="mt-2 text-muted">{intro}</p> : null}
    </div>
  );
});
