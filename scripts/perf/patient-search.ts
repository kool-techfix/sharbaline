/**
 * `pnpm perf:patient-search` — checks the M2 acceptance target: search returns in under 1 s
 * with 100,000 patients (scope §5 M2). On a throwaway local PostgreSQL 18 it loads 100,000
 * SYNTHETIC patients (CLAUDE.md rule 1), then times real searchPatients calls as hms_app,
 * audit write included, for each kind of search. Fails if any p95 is 1 s or more.
 * Run on the reference hardware for the real verdict; a dev laptop gives an indication.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { connectionUrl, ensureDatabase, ensureRoles, runPrisma, startCluster } from "../db/cluster";
import { freePort } from "../db/free-port";

const PATIENTS = Number(process.env.PERF_PATIENTS ?? 100_000);
const RUNS = 40;
const TARGET_MS = 1000;

// Synthetic name parts (common forms, combined at random: no real person).
const SURNAMES = ["Adeyemi", "Okafor", "Bello", "Nwosu", "Yusuf", "Akinyemi", "Eze", "Ibrahim", "Okonkwo", "Abubakar",
  "Olawale", "Chukwu", "Danjuma", "Afolabi", "Ogunleye", "Musa", "Obi", "Lawal", "Usman", "Balogun", "Nnamdi", "Adeleke",
  "Garba", "Ojo", "Ekwueme", "Sani", "Onyeka", "Babatunde", "Aliyu", "Okeke"];
const FIRST = ["Amina", "Chinedu", "Mariam", "Emeka", "Tomi", "Bola", "Ngozi", "Ibrahim", "Fatima", "Tunde", "Kemi",
  "Uche", "Halima", "Segun", "Zainab", "Ifeoma", "Musa", "Funmi", "Kelechi", "Aisha", "Yemi", "Chiamaka", "Bashir",
  "Ronke", "Obinna", "Hauwa", "Dayo", "Nkechi", "Sadiq", "Folake"];
const pick = <T>(list: readonly T[]) => list[randomBytes(2).readUInt16BE() % list.length]!;

const dataDir = await mkdtemp(path.join(tmpdir(), "hms-perf-"));
const port = await freePort();
const secret = () => randomBytes(18).toString("base64url");
const passwords = { ownerPassword: secret(), appPassword: secret() };
const cluster = await startCluster({ dataDir, port, superuserPassword: secret(), persistent: false, quiet: true });
let failed = false;
try {
  await ensureRoles(cluster, passwords);
  await ensureDatabase(cluster, "hms_perf");
  await runPrisma(["migrate", "deploy"], connectionUrl(port, "hms_owner", passwords.ownerPassword, "hms_perf"), true);

  const { dammCheckDigit } = await import("@/lib/domain/damm");
  const { nameSearchKey } = await import("@/lib/domain/names");
  const loader = await cluster.superClient("hms_perf");
  const actor = randomUUID();
  console.log(`Loading ${PATIENTS.toLocaleString()} synthetic patients…`);
  const started = Date.now();
  const BATCH = 5000;
  let seq = 1000;
  const samples: { number: string; phone: string; name: string; legacy: string }[] = [];
  for (let done = 0; done < PATIENTS; done += BATCH) {
    const rows = Array.from({ length: Math.min(BATCH, PATIENTS - done) }, () => {
      seq++;
      const surname = pick(SURNAMES);
      const firstName = pick(FIRST);
      const phone = `+2348${String(10_000_000 + (randomBytes(4).readUInt32BE() % 89_999_999)).padStart(9, "0")}`;
      const row = {
        id: randomUUID(),
        number: `HSP-${seq}${dammCheckDigit(String(seq))}`,
        seq,
        surname,
        firstName,
        dob: `${1930 + (seq % 90)}-${String(1 + (seq % 12)).padStart(2, "0")}-${String(1 + (seq % 28)).padStart(2, "0")}`,
        phone,
        legacy: `MC-${seq}`,
        nameSearch: nameSearchKey({ surname, firstName }),
      };
      if (samples.length < RUNS && seq % 997 === 0) {
        samples.push({ number: row.number, phone: `0${phone.slice(4)}`, name: `${surname} ${firstName}`, legacy: row.legacy });
      }
      return row;
    });
    await loader.query(
      `INSERT INTO patient (id, patient_number, patient_seq, surname, first_name, sex, date_of_birth, phone_e164,
                            legacy_card_number, name_search, consent_version, consent_recorded_at,
                            consent_recorded_by_id, created_by_id, updated_by_id)
       SELECT u.id::uuid, u.num, u.seq, u.sur, u.fn, (CASE WHEN u.seq % 2 = 0 THEN 'female' ELSE 'male' END)::"Sex",
              u.dob::date, u.ph, u.leg, u.ns, 'perf', now(), $9::uuid, $9::uuid, $9::uuid
         FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $10::text[])
              AS u(id, num, seq, sur, fn, dob, ph, leg, ns)`,
      [rows.map((r) => r.id), rows.map((r) => r.number), rows.map((r) => r.seq), rows.map((r) => r.surname),
        rows.map((r) => r.firstName), rows.map((r) => r.dob), rows.map((r) => r.phone), rows.map((r) => r.legacy), actor,
        rows.map((r) => r.nameSearch)],
    );
  }
  await loader.query("ANALYZE patient");
  await loader.end();
  console.log(`Loaded in ${((Date.now() - started) / 1000).toFixed(1)} s. Timing searches (${RUNS} each, as hms_app)…`);

  const { createDb } = await import("@/server/db/client");
  const { searchPatients } = await import("@/server/services/patients/records");
  const db = createDb(connectionUrl(port, "hms_app", passwords.appPassword, "hms_perf"));
  const ctx = () => ({
    actor: { kind: "user" as const, userId: actor, role: "front_desk" as const, sessionId: randomUUID() },
    requestId: `perf-${randomUUID()}`,
    ip: null,
    deviceId: null,
  });
  const kinds: [string, (s: (typeof samples)[number]) => string][] = [
    ["patient number", (s) => s.number],
    ["phone", (s) => s.phone],
    ["legacy card", (s) => s.legacy],
    ["full name", (s) => s.name],
    ["surname only", (s) => s.name.split(" ")[0]!],
    ["name with typo", (s) => s.name.slice(0, -2)],
  ];
  await searchPatients(ctx(), { query: "warm up" }, db);
  for (const [kind, query] of kinds) {
    const times: number[] = [];
    for (const sample of samples) {
      const t0 = performance.now();
      const outcome = await searchPatients(ctx(), { query: query(sample) }, db);
      times.push(performance.now() - t0);
      if (!outcome.ok || outcome.value.results.length === 0) throw new Error(`${kind}: no result for a known patient`);
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const verdict = p95 < TARGET_MS ? "ok" : "TOO SLOW";
    if (p95 >= TARGET_MS) failed = true;
    console.log(`  ${kind.padEnd(16)} p50 ${p50.toFixed(0).padStart(5)} ms   p95 ${p95.toFixed(0).padStart(5)} ms   ${verdict}`);
  }
  await db.$disconnect();
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await cluster.stop();
  await rm(dataDir, { recursive: true, force: true });
}
console.log(failed ? `FAIL: a search took ${TARGET_MS} ms or more at p95.` : `OK: every search under ${TARGET_MS} ms at p95.`);
process.exitCode = failed ? 1 : 0;
