import { uuidv7 } from "@/lib/ids";
import type { Permission } from "@/server/permissions/matrix";
import type { TestDatabase } from "../integration/helpers/db";
import { makeUser } from "../integration/helpers/auth";
import { userContext } from "../integration/helpers/context";
import { makePatient, patientInput } from "../integration/helpers/patients";
import { addToQueue } from "@/server/services/queue/queue";

/**
 * The expected permission and a valid input for every PROTECTED service, keyed by its audit
 * action. The permission-matrix
 * suite calls each service once per role with this input: roles the matrix denies must get
 * ForbiddenError, roles it allows must get past the permission check.
 *
 * Adding a protected service? Add its fixture here. The suite fails until you do, so no
 * service can ship without its role × action test (CLAUDE.md rule 6).
 */
export interface Fixture {
  /** The permission this service must declare. Changing a service's permission fails here. */
  permission: Permission;
  input: (t: TestDatabase) => Promise<unknown>;
}

const anotherUser = async (t: TestDatabase) => ({ userId: (await makeUser(t, { roles: ["nurse"] })).id });
const readUsers: Permission = { resource: "users", action: "read" };
const createUsers: Permission = { resource: "users", action: "create" };
const updateUsers: Permission = { resource: "users", action: "update" };
const createDemographics: Permission = { resource: "patient_demographics", action: "create" };
const readDemographics: Permission = { resource: "patient_demographics", action: "read" };
const updateDemographics: Permission = { resource: "patient_demographics", action: "update" };
const aPatient = async (t: TestDatabase) => ({ patientId: (await makePatient(t)).id });
const queuedEntry = async (t: TestDatabase) => {
  const id = uuidv7();
  await addToQueue(userContext("front_desk"), { id, patientId: (await makePatient(t)).id }, t.db);
  return { entryId: id };
};
const newAccount = async () => ({
  id: uuidv7(),
  staffId: `pm.${uuidv7().slice(-12)}`,
  displayName: "Matrix Test",
  email: null,
  roles: ["nurse"],
});

export const FIXTURES: Record<string, Fixture> = {
  "auth.session_revoke": { permission: updateUsers, input: anotherUser },
  "users.disable": { permission: updateUsers, input: anotherUser },
  "users.issue_temporary_password": { permission: updateUsers, input: anotherUser },
  "users.unlock_account": { permission: updateUsers, input: anotherUser },
  "users.reset_mfa": { permission: updateUsers, input: anotherUser },
  "users.list": { permission: readUsers, input: async () => ({}) },
  "users.view": { permission: readUsers, input: anotherUser },
  "users.create": { permission: createUsers, input: newAccount },
  "users.update_details": {
    permission: updateUsers,
    input: async (t) => ({ ...(await anotherUser(t)), displayName: "Renamed", email: null }),
  },
  "users.update_roles": {
    permission: updateUsers,
    input: async (t) => ({ ...(await anotherUser(t)), roles: ["lab"] }),
  },
  "users.enable": { permission: updateUsers, input: anotherUser },
  "patients.register": { permission: createDemographics, input: async () => patientInput() },
  "patients.duplicate_check": {
    permission: createDemographics,
    input: async () => {
      const { surname, firstName, birth, phone } = patientInput();
      return { surname, firstName, birth, phone };
    },
  },
  "patients.search": { permission: readDemographics, input: async () => ({ query: "Synthetic" }) },
  "patients.view": { permission: readDemographics, input: aPatient },
  "patients.update": {
    permission: updateDemographics,
    input: async (t) => {
      const { id, input } = await makePatient(t);
      const { rows } = await t.appPool.query("SELECT updated_at FROM patient WHERE id = $1", [id]);
      const { id: _id, consentConfirmed: _c, acknowledgedDuplicateIds: _a, ...details } = input;
      void _id;
      void _c;
      void _a;
      return {
        ...details,
        patientId: id,
        expectedUpdatedAt: (rows[0].updated_at as Date).toISOString(),
        paperFolderStatus: "partial",
      };
    },
  },
  "queue.add": { permission: { resource: "queue", action: "create" }, input: async (t) => ({ id: uuidv7(), ...(await aPatient(t)) }) },
  "queue.view": { permission: { resource: "queue", action: "read" }, input: async () => ({}) },
  "queue.mark_left": { permission: { resource: "queue", action: "update" }, input: queuedEntry },
};

/**
 * Services that need no role, with why. Listed explicitly so that making a service public is a
 * visible, reviewed change: the suite fails if this list and the code disagree.
 */
export const PUBLIC_SERVICES: Record<string, string> = {
  "auth.login": "signing in establishes identity",
  "auth.mfa_verify": "second sign-in step; the session token is the credential",
  "auth.recovery_code": "second sign-in step; the session token is the credential",
  "auth.mfa_enroll_start": "required enrollment during sign-in",
  "auth.mfa_enroll": "required enrollment during sign-in",
  "auth.password_change": "temporary-password step during sign-in",
  "auth.unlock": "the locked session's token plus password",
  "auth.logout": "ending one's own session",
  "auth.idle_lock": "locking only reduces access",
  "auth.role_switch": "own session, only to a role the account holds",
  "auth.mfa_self_enroll_start": "own account only; needs the session token and the account password",
  "auth.mfa_self_enroll": "own account only; needs a setup started with the password",
  "users.bootstrap_admin": "server-console first admin; refuses once an admin exists",
  "users.recover_admin": "server-console recovery of the only admin; refuses while another active admin exists",
};
