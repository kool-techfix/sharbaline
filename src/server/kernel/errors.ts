import type { MessageKey } from "@/lib/i18n";

/**
 * Exceptions the kernel understands. Each carries an i18n key for a plain-language message;
 * none carries user input or internal detail, so they are safe to show and to log.
 */
export abstract class ServiceError extends Error {
  abstract readonly code: string;
  readonly messageKey: MessageKey;

  constructor(messageKey: MessageKey) {
    super(messageKey);
    this.messageKey = messageKey;
  }
}

export class ForbiddenError extends ServiceError {
  override readonly name = "ForbiddenError";
  readonly code = "forbidden";

  constructor(readonly reasonCode: "role_not_permitted" | "record_not_permitted" = "role_not_permitted") {
    super("errors.forbidden");
  }
}

export interface ValidationIssue {
  /** Dotted field path, e.g. "nextOfKin.phone". Never the submitted value. */
  path: string;
  code: string;
}

export class ValidationError extends ServiceError {
  override readonly name = "ValidationError";
  readonly code = "invalid_input";

  constructor(readonly issues: ValidationIssue[]) {
    super("errors.invalidInput");
  }
}
