import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { actorOf, requireRole } from "@/server/http/guard";
import { requestContext } from "@/server/http/context";
import { listUsers } from "@/server/services/users/manage";
import { UserStatus } from "./_components/UserStatus";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireRole("admin");
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const outcome = await listUsers(await requestContext(actorOf(session)), { query });
  const users = outcome.ok ? outcome.value.users : [];

  return (
    <section aria-labelledby="users-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="users-title" className="text-3xl font-bold">
            {t("users.title")}
          </h1>
          <p className="mt-2 text-muted">{t("users.intro")}</p>
        </div>
        <Link
          href="/admin/users/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover"
        >
          <UserPlus aria-hidden="true" className="size-5" />
          {t("users.add")}
        </Link>
      </div>

      <form role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor="user-search">{t("users.search")}</Label>
          <Input id="user-search" name="q" type="search" defaultValue={query} placeholder={t("users.searchHint")} />
        </div>
        <Button type="submit" variant="secondary">
          {t("users.searchSubmit")}
        </Button>
        {query ? (
          <Link href="/admin/users" className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline">
            {t("users.clearSearch")}
          </Link>
        ) : null}
      </form>

      {outcome.ok && outcome.value.truncated ? <p className="text-muted">{t("users.truncated")}</p> : null}

      {users.length === 0 ? (
        <p>{t("users.none")}</p>
      ) : (
        <Table>
          <TableCaption>{t("users.title")}</TableCaption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("users.col.name")}</TableHeaderCell>
              <TableHeaderCell>{t("users.col.staffId")}</TableHeaderCell>
              <TableHeaderCell>{t("users.col.roles")}</TableHeaderCell>
              <TableHeaderCell>{t("users.col.status")}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link href={`/admin/users/${user.id}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">
                    {user.displayName}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{user.staffId}</TableCell>
                <TableCell>{user.roles.map((role) => t(`role.${role}`)).join(", ")}</TableCell>
                <TableCell>
                  <UserStatus user={user} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
