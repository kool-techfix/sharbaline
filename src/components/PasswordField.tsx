"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { Input } from "@/components/ui/input";

/** Password input with a show/hide toggle (a 44px button with a text label for screen readers). */
export function PasswordField(props: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-14" spellCheck={false} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? t("auth.signIn.hidePassword") : t("auth.signIn.showPassword")}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted hover:text-primary"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
      </button>
    </div>
  );
}
