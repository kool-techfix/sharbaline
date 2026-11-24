/**
 * The audit log is append-only and tamper-evident (CLAUDE.md rule 9, D-018).
 * Two layers: the app role lacks UPDATE/DELETE/TRUNCATE grants, and a trigger blocks them
 * even for the table owner. A hash chain makes any change made around both layers detectable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { writeAudit } from "@/server/audit/write";
import { userContext } from "../helpers/context";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

async function appendEntries(count: number): Promise<void> {
  // Each in its own transaction, concurrently, to exercise the chain lock.
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      writeAudit(t.db, userContext("nurse"), {
        action: "test.chain_entry",
        outcome: "success",
        metadata: { index: i },
      }),
    ),
  );
}

async function brokenLinks() {
  const { rows } = await t.ownerPool.query("SELECT broken_seq::int, problem FROM audit_log_verify_chain()");
  return rows;
}

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  return promise.then(
    () => ({ message: "no error" }),
    (e: { code?: string; message: string }) => e,
  );
}

describe("audit_log append-only enforcement", () => {
  beforeAll(async () => {
    await appendEntries(3);
  });

  it.each([
    ["UPDATE", "UPDATE audit_log SET action = 'test.changed'"],
    ["DELETE", "DELETE FROM audit_log"],
    ["TRUNCATE", "TRUNCATE audit_log"],
  ])("app role cannot %s (no grant)", async (_op, sql) => {
    expect((await pgError(t.appPool.query(sql))).code).toBe("42501"); // insufficient_privilege
  });

  it.each([
    ["UPDATE", "UPDATE audit_log SET action = 'test.changed'"],
    ["DELETE", "DELETE FROM audit_log"],
    ["TRUNCATE", "TRUNCATE audit_log"],
  ])("even the owner cannot %s (trigger)", async (_op, sql) => {
    const error = await pgError(t.ownerPool.query(sql));
    expect(error.code).toBe("HM002");
    expect(error.message).toMatch(/append-only/);
  });

  it("rejects free-text action names, where patient details could leak in", async () => {
    const error = await pgError(
      writeAudit(t.db, userContext("doctor"), { action: "Viewed Jane Doe record", outcome: "success" }),
    );
    expect(error.message).toMatch(/audit_log_action_format/);
  });
});

describe("audit_log hash chain", () => {
  it("links every entry, in order, under concurrent writers", async () => {
    await appendEntries(25);
    const { rows } = await t.appPool.query(
      "SELECT seq, encode(prev_hash, 'hex') AS prev, encode(hash, 'hex') AS hash FROM audit_log ORDER BY seq",
    );
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(rows[0].prev).toBe("0".repeat(64));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].prev).toBe(rows[i - 1].hash);
      expect(BigInt(rows[i].seq)).toBeGreaterThan(BigInt(rows[i - 1].seq));
    }
    expect(await brokenLinks()).toEqual([]);
  });

  it("ignores client-supplied seq and hash values", async () => {
    const id = uuidv7();
    await t.appPool.query(
      `INSERT INTO audit_log (id, seq, action, outcome, request_id, prev_hash, hash)
       VALUES ($1, 1, 'test.forged', 'success', 'req-forged', '\\x00', '\\x00')`,
      [id],
    );
    const { rows } = await t.appPool.query(
      "SELECT seq::int, length(hash) AS hash_len FROM audit_log WHERE id = $1",
      [id],
    );
    expect(rows[0].seq).toBeGreaterThan(1);
    expect(rows[0].hash_len).toBe(32);
    expect(await brokenLinks()).toEqual([]);
  });

  it("rejects audit writes under REPEATABLE READ, which would fork the chain", async () => {
    const client = await t.appPool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const error = await pgError(
        client.query(
          "INSERT INTO audit_log (id, action, outcome, request_id) VALUES ($1, 'test.rr', 'success', 'req-rr')",
          [uuidv7()],
        ),
      );
      expect(error.code).toBe("HM001");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  describe("tamper detection (simulating someone with database-owner access)", () => {
    async function tamper(sql: string, params: unknown[] = []) {
      const client = await t.ownerPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete");
        await client.query(sql, params);
        await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    it("detects an edited entry", async () => {
      const { rows } = await t.appPool.query("SELECT seq FROM audit_log ORDER BY seq OFFSET 2 LIMIT 1");
      const seq = rows[0].seq;
      await tamper("UPDATE audit_log SET outcome = 'denied' WHERE seq = $1", [seq]);
      expect(await brokenLinks()).toContainEqual({ broken_seq: Number(seq), problem: "hash_mismatch" });
    });

    it("detects a deleted entry", async () => {
      const { rows } = await t.appPool.query("SELECT seq FROM audit_log ORDER BY seq OFFSET 6 LIMIT 2");
      const [deleted, next] = [rows[0].seq, rows[1].seq];
      await tamper("DELETE FROM audit_log WHERE seq = $1", [deleted]);
      expect(await brokenLinks()).toContainEqual({ broken_seq: Number(next), problem: "prev_hash_mismatch" });
    });
  });
});
