import { describe, expect, it } from "vitest";
import { ageInYears, estimatedDateOfBirth } from "./age";
import { dammCheckDigit, dammIsValid } from "./damm";
import { DUPLICATE_THRESHOLD, duplicateScore, type DuplicateFacts } from "./duplicates";
import { nameSearchKey, nameSimilarity, normalizeName } from "./names";
import { formatPatientNumber, parsePatientNumber } from "./patient-number";
import { formatNigerianPhone, normalizeNigerianPhone } from "./phone";

describe("Damm check digit (D-003)", () => {
  it("matches the published examples", () => {
    expect(dammCheckDigit("572")).toBe(4);
    expect(dammCheckDigit("2073")).toBe(7); // HSP-2073 → HSP-20737 (D-003)
    expect(dammIsValid("5724")).toBe(true);
  });

  it("catches every single-digit error and every adjacent transposition", () => {
    for (let n = 10; n < 3000; n += 7) {
      const base = String(n);
      const valid = `${base}${dammCheckDigit(base)}`;
      for (let i = 0; i < valid.length; i++) {
        for (let d = 0; d <= 9; d++) {
          if (String(d) === valid[i]) continue;
          expect(dammIsValid(valid.slice(0, i) + d + valid.slice(i + 1))).toBe(false);
        }
        if (i + 1 < valid.length && valid[i] !== valid[i + 1]) {
          const swapped = valid.slice(0, i) + valid[i + 1] + valid[i] + valid.slice(i + 2);
          expect(dammIsValid(swapped)).toBe(false);
        }
      }
    }
  });
});

describe("patient numbers", () => {
  it("formats prefix, sequence and check digit", () => {
    expect(formatPatientNumber("HSP", 2073)).toBe("HSP-20737");
    expect(() => formatPatientNumber("hsp", 1)).toThrow();
    expect(() => formatPatientNumber("HSP", 0)).toThrow();
  });

  it("reads numbers with or without prefix, in any case, with spaces or dashes", () => {
    for (const typed of ["HSP-20737", "hsp20737", " 2073 7 ", "20737", "HSP 2073-7"]) {
      expect(parsePatientNumber(typed)).toMatchObject({ kind: "valid", digits: "20737" });
    }
  });

  it("rejects a wrong check digit and things that aren't numbers", () => {
    expect(parsePatientNumber("HSP-20736")).toEqual({ kind: "bad_check_digit" });
    expect(parsePatientNumber("Amina Yusuf")).toEqual({ kind: "not_a_number" });
  });
});

describe("Nigerian phone numbers", () => {
  it("normalises local, international and spaced forms to E.164", () => {
    for (const typed of ["0803 456 2187", "+234 803 456 2187", "2348034562187", "(0803) 456-2187"]) {
      expect(normalizeNigerianPhone(typed)).toBe("+2348034562187");
    }
    expect(normalizeNigerianPhone("01 234 5678")).toBe("+23412345678");
  });

  it("rejects implausible numbers", () => {
    for (const typed of ["12345", "0803 456", "+44 20 7946 0958", "phone"]) expect(normalizeNigerianPhone(typed)).toBeNull();
  });

  it("formats for display", () => {
    expect(formatNigerianPhone("+2348034562187")).toBe("0803 456 2187");
  });
});

describe("names", () => {
  it("normalises case, diacritics and punctuation", () => {
    expect(normalizeName("  ADÉBÁYỌ̀  Olú-wa ")).toBe("adebayo olu wa");
    expect(nameSearchKey({ surname: "Yusuf", firstName: "Amina", otherNames: null })).toBe("yusuf amina");
  });

  it("scores similarity regardless of word order and accents", () => {
    expect(nameSimilarity("Amina Yusuf", "Yusuf Amina")).toBe(1);
    expect(nameSimilarity("Adebayo Tunde", "Adébáyọ̀ Tunde")).toBe(1);
    expect(nameSimilarity("Amina Yusuf", "Aminat Yusuf")).toBeGreaterThan(0.6);
    expect(nameSimilarity("Amina Yusuf", "Chinedu Okafor")).toBeLessThan(0.1);
  });
});

describe("age", () => {
  it("counts whole years in the hospital's calendar", () => {
    expect(ageInYears("1990-06-15", "2026-06-14")).toBe(35);
    expect(ageInYears("1990-06-15", "2026-06-15")).toBe(36);
    expect(estimatedDateOfBirth(40, "2026-11-25")).toBe("1986-07-01");
  });
});

describe("duplicate scoring", () => {
  const amina: DuplicateFacts = {
    fullName: "Yusuf Amina",
    dateOfBirth: "1991-03-04",
    dobIsEstimated: false,
    phoneE164: "+2348034562187",
  };

  it("flags the same person entered slightly differently", () => {
    expect(duplicateScore(amina, { ...amina, fullName: "Yusuf Aminat" })).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(duplicateScore(amina, { ...amina, phoneE164: null })).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(duplicateScore(amina, { ...amina, dateOfBirth: "1991-04-03", phoneE164: null })).toBeGreaterThanOrEqual(
      DUPLICATE_THRESHOLD,
    );
    expect(
      duplicateScore(amina, { ...amina, dateOfBirth: "1990-07-01", dobIsEstimated: true }),
    ).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("doesn't flag family members who share a phone, or strangers born the same day", () => {
    expect(duplicateScore(amina, { ...amina, fullName: "Yusuf Ibrahim", dateOfBirth: "1965-01-01" })).toBeLessThan(
      DUPLICATE_THRESHOLD,
    );
    expect(duplicateScore(amina, { ...amina, fullName: "Okafor Chinedu", phoneE164: null })).toBeLessThan(
      DUPLICATE_THRESHOLD,
    );
  });
});
