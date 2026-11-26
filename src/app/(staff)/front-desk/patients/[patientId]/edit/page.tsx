import Link from "next/link";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { UUID_PATTERN } from "@/lib/ids";
import { formatNigerianPhone } from "@/lib/domain/phone";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { getPatient } from "@/server/services/patients/records";
import { PatientForm, type PatientFormValues } from "../../../_components/PatientForm";
import { displayName } from "@/app/(staff)/_components/patients/format";

export const dynamic = "force-dynamic";

export default async function EditPatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const session = await requireRole("front_desk");
  const { patientId } = await params;
  if (!UUID_PATTERN.test(patientId)) notFound();

  const outcome = await getPatient(await requestContext(actorOf(session)), { patientId });
  if (!outcome.ok) notFound();
  const record = outcome.value;
  if (record.view !== "full" || record.summary.view !== "full") notFound();
  const patient = record.summary;

  const initial: PatientFormValues = {
    surname: patient.surname,
    firstName: patient.firstName,
    otherNames: patient.otherNames ?? "",
    sex: patient.sex,
    birthKind: patient.ageIsEstimated ? "estimated" : "exact",
    dob: patient.ageIsEstimated ? "" : patient.dateOfBirth,
    age: patient.ageIsEstimated ? String(patient.age) : "",
    phone: patient.phoneE164 ? formatNigerianPhone(patient.phoneE164) : "",
    address: record.address ?? "",
    legacyCardNumber: patient.legacyCardNumber ?? "",
    kinName: record.nextOfKin?.name ?? "",
    kinRelationship: record.nextOfKin?.relationship ?? "",
    kinPhone: record.nextOfKin?.phoneE164 ? formatNigerianPhone(record.nextOfKin.phoneE164) : "",
    priorityFolder: record.priorityFolder,
    paperFolderStatus: record.paperFolderStatus,
    consent: true,
  };

  return (
    <section aria-labelledby="edit-title" className="space-y-6">
      <Link href={`/front-desk/patients/${patient.id}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("patients.edit.back")}
      </Link>
      <div>
        <h1 id="edit-title" className="text-3xl font-bold">
          {t("patients.edit.title")}
        </h1>
        <p className="mt-2 text-muted">
          {displayName(patient)} · <span className="font-mono">{patient.patientNumber}</span>
        </p>
      </div>
      <PatientForm
        mode="edit"
        patientId={patient.id}
        expectedUpdatedAt={record.updatedAt.toISOString()}
        initial={initial}
        hadNextOfKin={record.nextOfKin !== null}
      />
    </section>
  );
}
