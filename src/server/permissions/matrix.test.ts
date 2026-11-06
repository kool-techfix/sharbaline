import { describe, expect, it } from "vitest";
import { Role as PrismaRole } from "@/generated/prisma/enums";
import { PERMISSIONS, can, type Permission } from "./matrix";
import { MFA_REQUIRED_ROLES, ROLES, type Role } from "./roles";

const grants = PERMISSIONS as Record<string, Record<string, readonly Role[]>>;

function rolesFor(resource: string, action: string): readonly Role[] {
  return grants[resource]?.[action] ?? [];
}

describe("roles", () => {
  it("match the database Role enum exactly", () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
  });

  it("require MFA for doctor, pharmacist and admin", () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(["admin", "doctor", "pharmacist"]);
  });
});

describe("permission matrix (docs/scope.md §4.1)", () => {
  it("only grants known roles and never an empty action", () => {
    for (const [resource, actions] of Object.entries(grants)) {
      for (const [action, roles] of Object.entries(actions)) {
        expect(roles.length, `${resource}.${action}`).toBeGreaterThan(0);
        for (const role of roles) expect(ROLES).toContain(role);
      }
    }
  });

  it("gives admin no routine clinical access (break-glass only)", () => {
    for (const resource of [
      "allergies",
      "consultation_notes",
      "vitals",
      "test_orders",
      "test_results",
      "prescriptions",
    ]) {
      for (const action of Object.keys(grants[resource] ?? {})) {
        expect(rolesFor(resource, action), `${resource}.${action}`).not.toContain("admin");
      }
    }
    expect(rolesFor("scanned_documents", "read")).not.toContain("admin");
    expect(rolesFor("scanned_documents", "read_metadata")).toContain("admin");
  });

  it("never lets pharmacists edit prescriptions, only dispense (D-009)", () => {
    expect(rolesFor("prescriptions", "dispense")).toEqual(["pharmacist"]);
    expect(rolesFor("prescriptions", "create")).not.toContain("pharmacist");
    expect(rolesFor("prescriptions", "amend")).toEqual(["doctor"]);
  });

  it("keeps lab out of consultation notes (D-008)", () => {
    for (const action of Object.keys(grants.consultation_notes ?? {})) {
      expect(rolesFor("consultation_notes", action)).not.toContain("lab");
    }
    expect(rolesFor("test_orders", "read")).toContain("lab");
  });

  it("lets only lab create results and only admin manage users or read the audit log", () => {
    expect(rolesFor("test_results", "create")).toEqual(["lab"]);
    expect(rolesFor("users", "create")).toEqual(["admin"]);
    expect(rolesFor("audit_log", "read")).toEqual(["admin"]);
  });

  it("restricts scan restore to admin and scan upload to front desk and nurses", () => {
    expect(rolesFor("scanned_documents", "restore")).toEqual(["admin"]);
    expect([...rolesFor("scanned_documents", "create")].sort()).toEqual(["front_desk", "nurse"]);
  });

  it("can() answers per role", () => {
    const createUser: Permission = { resource: "users", action: "create" };
    expect(can("admin", createUser)).toBe(true);
    expect(can("doctor", createUser)).toBe(false);
  });
});
