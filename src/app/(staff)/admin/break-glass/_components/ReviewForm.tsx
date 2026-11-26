"use client";

import { useState, type FormEvent } from "react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import type { ReviewOutcome } from "@/server/services/break-glass/break-glass";
import { FieldError, RadioCards } from "../../_components/RadioCards";
import { review } from "../actions";

const OUTCOMES: ReviewOutcome[] = ["appropriate", "inappropriate", "needs_follow_up"];

/** One review of one break-glass event. The server refuses self-review and a second review. */
export function ReviewForm({ eventId }: { eventId: string }) {
  const [id] = useState(() => uuidv7());
  const [outcome, setOutcome] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<{ outcome?: string; comment?: string }>({});
  const { busy, message, run } = useAction();
  const name = `review-${eventId}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!outcome) found.outcome = t("breakGlass.review.outcome.error");
    else if (outcome !== "appropriate" && !comment.trim()) found.comment = t("breakGlass.review.comment.error");
    setErrors(found);
    if (found.outcome) return document.getElementById(`${name}-outcome-${OUTCOMES[0]}`)?.focus();
    if (found.comment) return document.getElementById(`${name}-comment`)?.focus();
    await run(
      () => review({ id, eventId, outcome: outcome as ReviewOutcome, comment: comment.trim() || null }),
      () => t("breakGlass.review.saved"),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <RadioCards
        name={`${name}-outcome`}
        legend={t("breakGlass.review.legend")}
        value={outcome}
        options={OUTCOMES.map((value) => ({ value, label: t(`breakGlass.outcome.${value}`) }))}
        error={errors.outcome}
        onChange={setOutcome}
      />
      <div className="space-y-2">
        <Label htmlFor={`${name}-comment`}>{t("breakGlass.review.comment")}</Label>
        <p id={`${name}-comment-hint`} className="text-sm text-muted">
          {t("breakGlass.review.commentHint")}
        </p>
        <Textarea
          id={`${name}-comment`}
          value={comment}
          maxLength={1000}
          onChange={(event) => setComment(event.target.value)}
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={errors.comment ? `${name}-comment-hint ${name}-comment-error` : `${name}-comment-hint`}
        />
        <FieldError id={`${name}-comment-error`} message={errors.comment} />
      </div>
      <FormMessage message={message?.tone === "error" ? message.text : null} />
      <Button type="submit" disabled={busy}>
        {t("breakGlass.review.submit")}
      </Button>
    </form>
  );
}
