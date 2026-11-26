"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type MessageKey } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { hospitalDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { patientDetailsSchema, type PatientDetailsInput } from "@/lib/validation/patient";
import type { DuplicateCandidate } from "@/server/services/patients/shared";
import { checkDuplicates, register, saveDetails } from "../actions";
import { ageLabel, calendarDate, displayName, phoneLabel, sexLabel } from "@/app/(staff)/_components/patients/format";

/*
 * Registration and edit form (scope §5 M2). The shared Zod schema gives early, per-field
 * feedback; the service validates again and is the authority. Registration asks for possible
 * duplicates first and shows them; going ahead needs an explicit "different person" confirmation,
 * which the server records (D-032).
 */

export type FolderStatus = "not_digitized" | "partial" | "digitized";

export interface PatientFormValues {
  surname: string;
  firstName: string;
  otherNames: string;
  sex: "" | "female" | "male";
  birthKind: "exact" | "estimated";
  dob: string;
  age: string;
  phone: string;
  address: string;
  legacyCardNumber: string;
  kinName: string;
  kinRelationship: string;
  kinPhone: string;
  priorityFolder: boolean;
  paperFolderStatus: FolderStatus;
  consent: boolean;
}

type Field = keyof PatientFormValues;
type Errors = Partial<Record<Field, string>>;

export const EMPTY_VALUES: PatientFormValues = {
  surname: "",
  firstName: "",
  otherNames: "",
  sex: "",
  birthKind: "exact",
  dob: "",
  age: "",
  phone: "",
  address: "",
  legacyCardNumber: "",
  kinName: "",
  kinRelationship: "",
  kinPhone: "",
  priorityFolder: false,
  paperFolderStatus: "not_digitized",
  consent: false,
};

/** Field order on screen: the first invalid one gets focus. */
const ORDER: Field[] = [
  "surname",
  "firstName",
  "otherNames",
  "sex",
  "dob",
  "age",
  "phone",
  "address",
  "legacyCardNumber",
  "kinName",
  "kinRelationship",
  "kinPhone",
  "consent",
];

const ERROR_KEYS: Partial<Record<Field, MessageKey>> = {
  surname: "patients.field.surname.error",
  firstName: "patients.field.firstName.error",
  otherNames: "patients.field.otherNames.error",
  sex: "patients.field.sex.error",
  dob: "patients.field.dob.error",
  age: "patients.field.age.error",
  phone: "patients.field.phone.error",
  address: "patients.field.address.error",
  legacyCardNumber: "patients.field.legacyCardNumber.error",
  kinName: "patients.field.kinName.error",
  kinRelationship: "patients.field.kinRelationship.error",
  kinPhone: "patients.field.phone.error",
  consent: "patients.field.consent.error",
};

function toDetails(values: PatientFormValues): PatientDetailsInput {
  const hasKin = Boolean(values.kinName.trim() || values.kinRelationship.trim() || values.kinPhone.trim());
  return {
    surname: values.surname,
    firstName: values.firstName,
    otherNames: values.otherNames,
    sex: values.sex as "female" | "male",
    birth:
      values.birthKind === "exact"
        ? { kind: "exact", date: values.dob }
        : { kind: "estimated", ageYears: /^\d{1,3}$/.test(values.age.trim()) ? Number(values.age.trim()) : Number.NaN },
    phone: values.phone,
    address: values.address,
    legacyCardNumber: values.legacyCardNumber,
    nextOfKin: hasKin ? { name: values.kinName, relationship: values.kinRelationship, phone: values.kinPhone } : null,
    priorityFolder: values.priorityFolder,
  };
}

function fieldOf(path: readonly PropertyKey[]): Field | null {
  const [head, sub] = path;
  if (head === "birth") return sub === "ageYears" ? "age" : "dob";
  if (head === "nextOfKin") return sub === "name" ? "kinName" : sub === "relationship" ? "kinRelationship" : "kinPhone";
  return typeof head === "string" && head in EMPTY_VALUES ? (head as Field) : null;
}

function validate(values: PatientFormValues, mode: "register" | "edit"): Errors {
  const errors: Errors = {};
  const set = (field: Field) => {
    const key = ERROR_KEYS[field];
    if (key && !errors[field]) errors[field] = t(key);
  };
  const parsed = patientDetailsSchema.safeParse(toDetails(values));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = fieldOf(issue.path);
      if (field) set(field);
    }
  }
  if (values.birthKind === "exact" && values.dob && (values.dob > hospitalDateKey(new Date()) || values.dob < "1880-01-01")) {
    set("dob");
  }
  if (mode === "register" && !values.consent) set("consent");
  return errors;
}

type Props =
  | { mode: "register" }
  | { mode: "edit"; patientId: string; expectedUpdatedAt: string; initial: PatientFormValues; hadNextOfKin: boolean };

export function PatientForm(props: Props) {
  const router = useRouter();
  const { reportUnreachable } = useConnection();
  // One id per form: a retried submit is the same registration, never a second patient (rule 11).
  const [id] = useState(() => uuidv7());
  const [values, setValues] = useState<PatientFormValues>(props.mode === "edit" ? props.initial : EMPTY_VALUES);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);
  const duplicatesHeading = useRef<HTMLHeadingElement>(null);
  const today = hospitalDateKey(new Date());

  useEffect(() => {
    if (candidates && candidates.length > 0) duplicatesHeading.current?.focus();
  }, [candidates]);

  function set<F extends Field>(field: F, value: PatientFormValues[F]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    // Changed details need a fresh duplicate check.
    if (field !== "consent" && candidates) {
      setCandidates(null);
      setConfirmedDifferent(false);
    }
  }

  async function call<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch {
      reportUnreachable();
      setMessage(t("auth.error.serverUnavailable"));
      return null;
    }
  }

  async function lookForDuplicates(): Promise<DuplicateCandidate[] | null> {
    const details = toDetails(values);
    const result = await call(() =>
      checkDuplicates({
        surname: details.surname,
        firstName: details.firstName,
        otherNames: details.otherNames ?? null,
        birth: details.birth,
        phone: details.phone ?? null,
      }),
    );
    if (!result) return null;
    if (!result.ok) {
      setMessage(result.message);
      return null;
    }
    return result.data.candidates;
  }

  async function registerNow(acknowledged: string[]) {
    const result = await call(() =>
      register({ ...toDetails(values), id, consentConfirmed: true, acknowledgedDuplicateIds: acknowledged }),
    );
    if (!result) return;
    if (result.ok) {
      router.replace(`/front-desk/patients/${result.data.patientId}?registered=1`);
      return;
    }
    if (result.code === "possible_duplicate") {
      // Someone registered a similar patient meanwhile: show the up-to-date list.
      const found = await lookForDuplicates();
      if (found) {
        setConfirmedDifferent(false);
        setCandidates(found);
      }
    }
    setMessage(result.message);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values, props.mode);
    setErrors(found);
    setStaleRecord(false);
    if (Object.keys(found).length > 0) {
      setMessage(t("errors.invalidInput"));
      const first = ORDER.find((field) => found[field]);
      if (first) document.getElementById(first === "sex" ? "sex-female" : first)?.focus();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (props.mode === "edit") {
        const result = await call(() =>
          saveDetails({
            ...toDetails(values),
            patientId: props.patientId,
            expectedUpdatedAt: props.expectedUpdatedAt,
            paperFolderStatus: values.paperFolderStatus,
          }),
        );
        if (!result) return;
        if (result.ok) {
          router.push(`/front-desk/patients/${props.patientId}?saved=${result.data.changed > 0 ? "1" : "0"}`);
          return;
        }
        setStaleRecord(result.code === "changed_elsewhere");
        setMessage(result.message);
        return;
      }
      const list = await lookForDuplicates();
      if (!list) return;
      if (list.length > 0) {
        setConfirmedDifferent(false);
        setCandidates(list);
        return;
      }
      await registerNow([]);
    } finally {
      setBusy(false);
    }
  }

  async function onRegisterAnyway() {
    if (!candidates) return;
    setBusy(true);
    setMessage(null);
    try {
      await registerNow(candidates.map((candidate) => candidate.patient.id));
    } finally {
      setBusy(false);
    }
  }

  const describedBy = (field: Field, hint?: boolean) =>
    [hint ? `${field}-hint` : null, errors[field] ? `${field}-error` : null].filter(Boolean).join(" ") || undefined;

  const text = (field: Field, label: string, options: { hint?: string; required?: boolean; maxLength: number } & Record<string, unknown>) => {
    const { hint, required, maxLength, ...rest } = options;
    return (
      <div className="space-y-2">
        <Label htmlFor={field}>
          {label}
          {required ? null : <span className="font-normal text-muted"> {t("patients.optional")}</span>}
        </Label>
        {hint ? (
          <p id={`${field}-hint`} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
        <Input
          id={field}
          name={field}
          autoComplete="off"
          maxLength={maxLength}
          required={required}
          value={values[field] as string}
          onChange={(event) => set(field, event.target.value as never)}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={describedBy(field, Boolean(hint))}
          {...rest}
        />
        <FieldError field={field} message={errors[field]} />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8" aria-busy={busy}>
      <Section title={t("patients.form.identity")}>
        <div className="grid gap-5 md:grid-cols-2">
          {text("surname", t("patients.field.surname"), { required: true, maxLength: 100 })}
          {text("firstName", t("patients.field.firstName"), { required: true, maxLength: 100 })}
        </div>
        {text("otherNames", t("patients.field.otherNames"), { maxLength: 100 })}

        <Choice
          name="sex"
          legend={t("patients.field.sex")}
          value={values.sex}
          error={errors.sex}
          options={[
            { value: "female", label: sexLabel("female") },
            { value: "male", label: sexLabel("male") },
          ]}
          onChange={(value) => set("sex", value as "female" | "male")}
        />

        <Choice
          name="birthKind"
          legend={t("patients.field.birth")}
          value={values.birthKind}
          options={[
            { value: "exact", label: t("patients.field.birthExact") },
            { value: "estimated", label: t("patients.field.birthEstimated") },
          ]}
          onChange={(value) => set("birthKind", value as "exact" | "estimated")}
        />
        {values.birthKind === "exact"
          ? text("dob", t("patients.field.dob"), { required: true, maxLength: 10, type: "date", max: today, min: "1880-01-01", className: "md:max-w-xs" })
          : text("age", t("patients.field.age"), {
              required: true,
              maxLength: 3,
              inputMode: "numeric",
              hint: t("patients.field.ageHint"),
              className: "md:max-w-32",
            })}
      </Section>

      <Section title={t("patients.form.contact")}>
        <div className="grid gap-5 md:grid-cols-2">
          {text("phone", t("patients.field.phone"), { maxLength: 30, type: "tel", inputMode: "tel", hint: t("patients.field.phoneHint") })}
          {text("legacyCardNumber", t("patients.field.legacyCardNumber"), {
            maxLength: 40,
            hint: t("patients.field.legacyCardNumberHint"),
          })}
        </div>
        {text("address", t("patients.field.address"), { maxLength: 300 })}
      </Section>

      <Section
        title={t("patients.form.nextOfKin")}
        intro={
          props.mode === "edit" && props.hadNextOfKin ? t("patients.form.nextOfKinKeep") : t("patients.form.nextOfKinIntro")
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          {text("kinName", t("patients.field.kinName"), { maxLength: 120 })}
          {text("kinRelationship", t("patients.field.kinRelationship"), { maxLength: 60, hint: t("patients.field.kinRelationshipHint") })}
        </div>
        <div className="md:max-w-[calc(50%-0.625rem)]">
          {text("kinPhone", t("patients.field.kinPhone"), { maxLength: 30, type: "tel", inputMode: "tel" })}
        </div>
      </Section>

      <Section title={t("patients.form.folder")}>
        {props.mode === "edit" ? (
          <Choice
            name="paperFolderStatus"
            legend={t("patients.field.paperFolderStatus")}
            value={values.paperFolderStatus}
            options={(["not_digitized", "partial", "digitized"] as const).map((value) => ({
              value,
              label: t(`patients.folder.${value}`),
            }))}
            onChange={(value) => set("paperFolderStatus", value as FolderStatus)}
          />
        ) : null}
        <Check
          id="priorityFolder"
          checked={values.priorityFolder}
          onChange={(checked) => set("priorityFolder", checked)}
          label={t("patients.field.priorityFolder")}
          hint={t("patients.field.priorityFolderHint")}
        />
      </Section>

      {props.mode === "register" ? (
        <Section title={t("patients.form.consent")}>
          <p className="max-w-3xl">{t("patients.consent.notice")}</p>
          <Check
            id="consent"
            checked={values.consent}
            onChange={(checked) => set("consent", checked)}
            label={t("patients.field.consent")}
            error={errors.consent}
          />
        </Section>
      ) : null}

      {candidates && candidates.length > 0 ? (
        <DuplicateWarning
          headingRef={duplicatesHeading}
          candidates={candidates}
          confirmed={confirmedDifferent}
          onConfirmedChange={setConfirmedDifferent}
          onRegister={onRegisterAnyway}
          busy={busy}
        />
      ) : null}

      <FormMessage id="patient-form-message" message={message} />
      {staleRecord && props.mode === "edit" ? (
        <a href={`/front-desk/patients/${props.patientId}/edit`} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
          {t("patients.edit.reload")}
        </a>
      ) : null}

      {candidates && candidates.length > 0 ? null : (
        <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Button type="submit" disabled={busy}>
            {props.mode === "register" ? t("patients.register.submit") : t("patients.edit.submit")}
          </Button>
          <Link
            href={props.mode === "register" ? "/front-desk" : `/front-desk/patients/${props.patientId}`}
            className="inline-flex min-h-11 items-center rounded-md border border-primary px-4 font-semibold text-primary hover:bg-primary-soft"
          >
            {t("patients.form.cancel")}
          </Link>
        </div>
      )}
    </form>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-5 rounded-md border border-border bg-surface p-5">
      <legend className="px-1 text-xl font-bold text-heading">{title}</legend>
      {intro ? <p className="text-muted">{intro}</p> : null}
      {children}
    </fieldset>
  );
}

function FieldError({ field, message }: { field: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${field}-error`} className="flex items-start gap-2 text-base font-semibold text-danger-text">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      {message}
    </p>
  );
}

/** A small set of options as large radio buttons: no typing, keyboard-friendly (arrow keys). */
function Choice({
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
  error?: string;
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
      <FieldError field={name} message={error} />
    </fieldset>
  );
}

function Check({
  id,
  checked,
  onChange,
  label,
  hint,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  error?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="size-6 shrink-0 accent-primary"
        />
        <span className="font-semibold text-heading">{label}</span>
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="pl-9 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <FieldError field={id} message={error} />
    </div>
  );
}

function DuplicateWarning({
  headingRef,
  candidates,
  confirmed,
  onConfirmedChange,
  onRegister,
  busy,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  candidates: DuplicateCandidate[];
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  onRegister: () => void;
  busy: boolean;
}) {
  return (
    <section aria-labelledby="duplicates-title" className="space-y-4 rounded-md border-2 border-warning-text bg-warning-bg p-5">
      <h2
        id="duplicates-title"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-xl font-bold text-warning-text"
      >
        <AlertTriangle aria-hidden="true" className="size-6 shrink-0" />
        {t("patients.duplicates.title")}
      </h2>
      <p className="text-text">{t("patients.duplicates.intro")}</p>
      <ul className="space-y-3">
        {candidates.map(({ patient }) => (
          <li key={patient.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
            <div className="space-y-1">
              <p className="font-semibold text-heading">
                {displayName(patient)} <span className="font-mono font-normal">· {patient.patientNumber}</span>
              </p>
              <p className="text-muted">
                {[
                  sexLabel(patient.sex),
                  ageLabel(patient),
                  patient.ageIsEstimated ? null : t("patients.duplicates.born", { date: calendarDate(patient.dateOfBirth) }),
                  patient.phoneE164 ? phoneLabel(patient.phoneE164) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Link
              href={`/front-desk/patients/${patient.id}`}
              // Says whose record; starts with the visible text (WCAG 2.5.3).
              aria-label={`${t("patients.duplicates.open")}: ${displayName(patient)}`}
              className="inline-flex min-h-11 items-center rounded-md border border-primary bg-surface px-4 font-semibold text-primary hover:bg-primary-soft"
            >
              {t("patients.duplicates.open")}
            </Link>
          </li>
        ))}
      </ul>
      <label htmlFor="confirm-different" className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id="confirm-different"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="size-6 shrink-0 accent-primary"
        />
        <span className="font-semibold text-heading">{t("patients.duplicates.confirm")}</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button disabled={!confirmed || busy} onClick={onRegister}>
          {t("patients.duplicates.registerAnyway")}
        </Button>
        <Link
          href="/front-desk"
          className="inline-flex min-h-11 items-center rounded-md border border-primary bg-surface px-4 font-semibold text-primary hover:bg-primary-soft"
        >
          {t("patients.form.cancel")}
        </Link>
      </div>
    </section>
  );
}
