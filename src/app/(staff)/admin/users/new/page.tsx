import Link from "next/link";
import { t } from "@/lib/i18n";
import { requireRole } from "@/server/http/guard";
import { NewUserForm } from "./_components/NewUserForm";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  await requireRole("admin");
  return (
    <section aria-labelledby="new-user-title" className="space-y-6">
      <Link href="/admin/users" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("users.back")}
      </Link>
      <h1 id="new-user-title" className="text-3xl font-bold">
        {t("users.new.title")}
      </h1>
      <NewUserForm />
    </section>
  );
}
