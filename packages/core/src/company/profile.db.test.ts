import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { auditFor, crew, manager, owner } from "../invoices/test-helpers";
import { getLogoForClientPdf } from "../portal/logo";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { MAX_LOGO_BYTES } from "./logo";
import {
  getCompanyLogoMeta,
  getCompanyProfile,
  getLogoForPdf,
  readCompanyLogo,
  readCompanyLogoVersion,
  removeCompanyLogo,
  setCompanyLogo,
  updateCompanyAddress,
} from "./profile";

// Made-up data only. Every test runs in a rolled-back transaction.

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const AS_PORTAL = `SET LOCAL ROLE "ace_portal"`;

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** A PNG the inspection accepts (signature, IHDR, IEND). Enough for storage tests. */
const png = (width = 64, height = 64) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...[0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  ]);
/** SOI then a SOF0 with the size. */
const jpeg = () =>
  Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 100, 0, 200, 1, 1, 0x11, 0, 0xff, 0xd9,
  ]);

const BLANK = { line1: "", line2: "", suburb: "", city: "", postalCode: "" };
const ADDRESS = {
  line1: "1 ZZ Test Road",
  line2: "",
  suburb: "Testville",
  city: "Testcity",
  postalCode: "0000",
};

/** Starts each test from no logo and a blank address (the dev database may hold either). */
async function clean(tx: Tx) {
  await tx.companyLogo.deleteMany({ where: { id: "singleton" } });
  await tx.organisationSettings.update({
    where: { id: "singleton" },
    data: {
      addressLine1: "",
      addressLine2: "",
      addressSuburb: "",
      addressCity: "",
      addressPostalCode: "",
    },
    select: { id: true },
  });
}

/** From a second connection: fails at once if another open transaction holds the settings row lock. */
const probeSettingsLock = () =>
  withRollback(async (tx) => {
    await tx.$queryRaw`select "id" from "organisation_settings" where "id" = 'singleton' for update nowait`;
  });

const ownerLines = async (tx: Tx) =>
  (await auditFor(tx, "company_profile", "singleton")).filter((l) => l.actorId === owner.id);

describe.skipIf(!dbTestsEnabled)("company logo", () => {
  it("sets, replaces and removes the logo, with audit lines of fixed words", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      expect(await readCompanyLogo(tx)).toBeNull();
      expect(await readCompanyLogoVersion(tx)).toBeNull();

      const first = png();
      await setCompanyLogo(tx, owner, first);
      const stored = await readCompanyLogo(tx);
      expect(stored?.contentType).toBe("image/png");
      expect([...(stored?.data ?? [])]).toEqual([...first]);
      expect(await readCompanyLogoVersion(tx)).toBe(String(stored?.updatedAt.getTime()));
      expect(await getLogoForPdf(tx, manager)).toEqual({ data: stored?.data, format: "png" });

      const second = jpeg();
      await setCompanyLogo(tx, owner, second);
      expect(await getCompanyLogoMeta(tx, owner)).toMatchObject({
        contentType: "image/jpeg",
        byteSize: second.length,
      });
      expect((await getLogoForPdf(tx, owner))?.format).toBe("jpg");
      expect(await tx.companyLogo.count()).toBe(1);

      await removeCompanyLogo(tx, owner);
      expect(await readCompanyLogo(tx)).toBeNull();
      await removeCompanyLogo(tx, owner); // nothing there: no write, no audit

      const lines = await ownerLines(tx);
      expect(lines.map((l) => l.action).sort()).toEqual([
        "company.logo_removed",
        "company.logo_set",
        "company.logo_set",
      ]);
      expect(lines.map((l) => l.after)).toContainEqual({
        contentType: "image/png",
        byteSize: first.length,
      });
      expect(lines.map((l) => l.after)).toContainEqual({
        contentType: "image/jpeg",
        byteSize: second.length,
      });
      expect(lines.find((l) => l.action === "company.logo_removed")?.after).toBeNull();
    });
  });

  it("only the owner changes the logo; a manager may see whether there is one", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      for (const actor of [manager, crew]) {
        await expect(setCompanyLogo(tx, actor, png())).rejects.toBeInstanceOf(ForbiddenError);
        await expect(removeCompanyLogo(tx, actor)).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(getCompanyLogoMeta(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getLogoForPdf(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await getCompanyLogoMeta(tx, manager)).toBeNull();
      await setCompanyLogo(tx, owner, png());
      expect(await getCompanyLogoMeta(tx, manager)).toMatchObject({ contentType: "image/png" });
    });
  });

  it("a corrupt, oversize or SVG upload is refused and leaves the stored logo unchanged", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      const good = png();
      await setCompanyLogo(tx, owner, good);
      const before = await readCompanyLogo(tx);
      const oversize = new Uint8Array(MAX_LOGO_BYTES + 1);
      oversize.set(good);
      const bad: [Uint8Array, string][] = [
        [good.slice(0, 20), "The picture could not be read. Save it again and try once more."],
        [oversize, "Use a picture of 500 KB or less."],
        [
          new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
          "Use a PNG or JPEG picture.",
        ],
      ];
      for (const [bytes, problem] of bad) {
        const error = await setCompanyLogo(tx, owner, bytes).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DomainError);
        expect((error as Error).message).toBe(problem);
      }
      expect(await readCompanyLogo(tx)).toEqual(before);
      expect((await ownerLines(tx)).map((l) => l.action)).toEqual(["company.logo_set"]);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("company profile and address", () => {
  it("owner and manager may view the profile; it shows the names, the contact details and the logo", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      await expect(getCompanyProfile(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      const profile = await getCompanyProfile(tx, manager);
      const org = await tx.organisationSettings.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { legalName: true, tradingName: true },
      });
      const wording = await tx.quoteWording.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { registrationNumber: true, phone: true, email: true, website: true },
      });
      expect(profile).toEqual({ ...org, ...wording, address: BLANK, logo: null });
      await setCompanyLogo(tx, owner, png());
      const version = await readCompanyLogoVersion(tx);
      expect((await getCompanyProfile(tx, owner)).logo).toEqual({
        contentType: "image/png",
        byteSize: png().length,
        version,
      });
    });
  });

  it("only the owner saves the address; the audit lists field names only and a no-op saves nothing", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      for (const actor of [manager, crew]) {
        await expect(updateCompanyAddress(tx, actor, ADDRESS)).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      await updateCompanyAddress(tx, owner, ADDRESS);
      expect((await getCompanyProfile(tx, owner)).address).toEqual(ADDRESS);
      await updateCompanyAddress(tx, owner, ADDRESS); // unchanged
      await updateCompanyAddress(tx, owner, { ...ADDRESS, city: "Othercity" });
      const lines = await ownerLines(tx);
      expect(lines.map((l) => l.action)).toEqual([
        "company.address_changed",
        "company.address_changed",
      ]);
      expect(lines.map((l) => l.after)).toContainEqual({
        fields: ["line1", "suburb", "city", "postalCode"],
      });
      expect(lines.map((l) => l.after)).toContainEqual({ fields: ["city"] });
      const text = JSON.stringify(lines);
      expect(text).not.toContain("ZZ Test Road");
      expect(text).not.toContain("Othercity");

      // A bad value is refused with a plain sentence and changes nothing.
      await expect(
        updateCompanyAddress(tx, owner, { ...ADDRESS, line1: "a\u0000b" }),
      ).rejects.toThrow("Remove the special characters.");
      expect((await getCompanyProfile(tx, owner)).address.city).toBe("Othercity");
      // A blank address is valid.
      await updateCompanyAddress(tx, owner, BLANK);
      expect((await getCompanyProfile(tx, owner)).address).toEqual(BLANK);
    });
  });

  it("an address save locks the settings row first, even when it changes nothing", async () => {
    await withRollback(async (first) => {
      // No other write in `first`: the current address saved back unchanged is a true no-op, so any lock
      // `first` holds on the settings row afterwards can only come from updateCompanyAddress itself.
      const current = (await getCompanyProfile(first, owner)).address;
      await updateCompanyAddress(first, owner, current);
      expect(await ownerLines(first)).toEqual([]);
      await expect(probeSettingsLock()).rejects.toThrow(/could not obtain lock/i);
    });
  });

  it("a logo save locks the settings row too", async () => {
    await withRollback(async (first) => {
      await setCompanyLogo(first, owner, png());
      await expect(probeSettingsLock()).rejects.toThrow(/could not obtain lock/i);
    });
  });

  it("the lock probe succeeds when nothing holds the row", async () => {
    await expect(probeSettingsLock()).resolves.toBeUndefined();
  });
});

describe.skipIf(!dbTestsEnabled)("the logo under the portal's database login", () => {
  it("ace_portal can read the logo columns the reads use", async () => {
    await withRollback(async (tx) => {
      await clean(tx);
      await setCompanyLogo(tx, owner, png());
      const asStaff = await readCompanyLogo(tx);
      await tx.$executeRawUnsafe(AS_PORTAL);
      expect(await readCompanyLogo(tx)).toEqual(asStaff);
      expect(await readCompanyLogoVersion(tx)).toBe(String(asStaff?.updatedAt.getTime()));
      expect(await getLogoForClientPdf(tx)).toEqual({ data: asStaff?.data, format: "png" });
      await tx.$executeRawUnsafe(`RESET ROLE`);
    });
  });

  const refused: [string, string][] = [
    ["reading who changed the logo", `select "updatedById" from company_logo`],
    ["changing the logo", `update company_logo set "byteSize" = 1`],
    ["removing the logo", `delete from company_logo`],
    [
      "adding a logo",
      `insert into company_logo ("id", "data", "contentType", "byteSize", "updatedAt") values ('singleton', '\\x00', 'image/png', 1, now())`,
    ],
  ];
  for (const [label, sql] of refused) {
    it(`ace_portal is refused ${label}`, async () => {
      await expect(
        withRollback(async (tx) => {
          await tx.$executeRawUnsafe(AS_PORTAL);
          await tx.$queryRawUnsafe(sql);
        }),
      ).rejects.toThrow(
        /permission denied for (table|column|relation)|violates row-level security/i,
      );
    });
  }
});
