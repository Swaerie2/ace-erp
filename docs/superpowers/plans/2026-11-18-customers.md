# Module 1: Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can add, find, edit, archive and import customers (with contacts and properties); crew see a restricted view; the owner can export and anonymise a customer.

**Architecture:** Business rules and database access live in `packages/core/src/customers/` as plain functions that take a database handle plus an `Actor` (who is asking). Each function checks the actor's role itself, so no screen can leak restricted data. The admin app (`apps/admin`) adds a staff shell and server-rendered pages whose server actions call those functions inside a database transaction. Pure rules (phone, validation, CSV mapping) are unit-tested; database behaviour is tested against the dev database inside transactions that always roll back, so no test data is ever kept.

**Tech Stack:** Next.js 16.4 (App Router, server actions), React 19, TypeScript strict, Prisma 7 with `@prisma/adapter-pg`, Supabase Postgres, zod 4, vitest 5, papaparse (CSV), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-18-customers-design.md`

## Global Constraints

- Not VAT registered; money is whole cents (`Int`), shown with `formatZAR` ("R1,234.56"). No VAT anywhere.
- Every new table: Row Level Security enabled, no policies, privileges revoked from `anon` and `authenticated`. Only server code (service connection) reads or writes.
- Every protected page, server action and route handler calls `requireStaff(...)` itself. A layout alone is not enough (layouts do not re-run on every navigation).
- Role rules are enforced inside `packages/core` functions (`assertRole`), not only in screens. CREW never receives fees, emails, phones, billing details or notes.
- Customers are archived, never hard-deleted. Only the owner can anonymise or export.
- **Audit entries store field names and ids, never personal values** (so anonymising a customer leaves no personal data behind in the append-only log). Passwords, codes and tokens are never logged.
- Phone numbers stored as `+27XXXXXXXXX`; emails stored lowercase.
- CSV import limits: 2 MB, 2,000 rows, `.csv` only. The uploaded file is never stored. `*.csv` stays in `.gitignore`.
- No real client data in git, in tests or in the dev database. Tests and manual checks use made-up customers only.
- Code style: Prettier (`npm run format`), ESLint clean, `noUncheckedIndexedAccess` is on (index access can be `undefined`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit locally after each task; push only after the final task and the owner's OK.
- Next.js 16 specifics already used in this repo: `params` and `searchParams` are Promises (`await` them); `proxy.ts` replaces middleware; server actions live in `"use server"` files that export only async functions and types.

## File Structure

```
packages/core/
  prisma/schema.prisma                         MODIFY  add enums + Customer, Contact, Property
  prisma/migrations/20261118120000_customers/  CREATE  tables + protections
  vitest.config.ts                             CREATE
  scripts/test-db.mjs                          CREATE  runs *.db.test.ts against the dev database
  package.json                                 MODIFY  papaparse, test:db script
  src/index.ts                                 MODIFY  export customers module
  src/testing/rollback.ts                      CREATE  withRollback() test helper
  src/customers/
    phone.ts, number.ts                        CREATE  pure helpers (+ tests)
    schemas.ts                                 CREATE  zod validation for forms (+ tests)
    access.ts                                  CREATE  Actor, roles, ForbiddenError, DomainError
    store.ts                                   CREATE  Store type, inTx, audit + diff helpers
    mappers.ts                                 CREATE  validated input -> database fields
    views.ts                                   CREATE  the crew-safe column list (+ test)
    customers.ts                               CREATE  create/update/archive/list/get/crew/activity
    contacts.ts, properties.ts                 CREATE
    duplicates.ts                              CREATE
    privacy.ts                                 CREATE  export + anonymise
    csv.ts, import.ts                          CREATE  CSV parsing, mapping, preview, commit
    index.ts                                   CREATE  barrel
apps/admin/
  next.config.ts                               MODIFY  server action body limit 3mb
  src/lib/actor.ts, form.ts                    CREATE
  src/components/form.tsx                      CREATE  shared form fields
  src/app/page.tsx                             DELETE  replaced by the (staff) group
  src/app/(staff)/layout.tsx, page.tsx         CREATE  shell + redirect to /customers
  src/app/(staff)/customers/...                CREATE  list, new, detail, import, export
```

---

### Task 1: Database tables, protections and test harness

**Files:**

- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/20261118120000_customers/migration.sql`
- Create: `packages/core/vitest.config.ts`, `packages/core/scripts/test-db.mjs`, `packages/core/src/testing/rollback.ts`, `packages/core/src/customers/db-protection.db.test.ts`
- Modify: `packages/core/package.json`, root `package.json`

**Interfaces:**

- Consumes: existing `getDb()` from `packages/core/src/db.ts`.
- Produces: Prisma models `Customer`, `Contact`, `Property`; enums `CustomerType`, `CustomerStatus`, `CustomerSource`, `ServiceFrequency`; `withRollback<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`; npm script `npm run test:db`.

- [ ] **Step 1: Add the models to `schema.prisma`** (append below `AuditLog`; also change the header comment line 3-4 to say "Modules 0 and 1")

```prisma
enum CustomerType {
  PERSON
  COMPANY
}

enum CustomerStatus {
  LEAD
  ACTIVE
  PAUSED
  ARCHIVED
}

enum CustomerSource {
  REFERRAL
  GOOGLE
  FACEBOOK
  DIRECTORY
  OTHER
}

enum ServiceFrequency {
  WEEKLY
  FORTNIGHTLY
  MONTHLY
  ONCE_OFF
}

/// The account quotes and invoices go to. Archived, never deleted.
model Customer {
  id                  String          @id @default(uuid()) @db.Uuid
  /// Shown as C-0001. A database sequence, so numbers are never reused.
  number              Int             @unique @default(autoincrement())
  type                CustomerType
  displayName         String
  companyName         String?
  registrationNumber  String?
  status              CustomerStatus  @default(ACTIVE)
  /// Remembered so "restore" returns the customer to where it was.
  statusBeforeArchive CustomerStatus?
  billingLine1        String?
  billingLine2        String?
  billingSuburb       String?
  billingCity         String?
  billingPostalCode   String?
  source              CustomerSource?
  sourceNote          String?
  /// Internal only. Never shown to crew or in the client portal.
  notes               String?
  /// POPIA: when and how they agreed to us holding their details.
  consentAt           DateTime?
  consentSource       String?
  consentNote         String?
  archivedAt          DateTime?
  anonymisedAt        DateTime?
  createdById         String?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  contacts   Contact[]
  properties Property[]

  @@index([displayName])
  @@index([status])
  @@map("customers")
}

/// A person at a customer (owner, trustee, managing agent, tenant...).
model Contact {
  id               String   @id @default(uuid()) @db.Uuid
  customerId       String   @db.Uuid
  name             String
  role             String?
  /// Always lowercase (database constraint).
  email            String?
  /// Always +27 format.
  phone            String?
  receivesQuotes   Boolean  @default(true)
  receivesInvoices Boolean  @default(true)
  /// Module 4: this contact's email becomes a client-portal login.
  portalAccess     Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  customer Customer @relation(fields: [customerId], references: [id])

  @@index([customerId])
  @@index([email])
  @@index([phone])
  @@map("contacts")
}

/// A place where work happens. A customer can have several.
model Property {
  id                    String            @id @default(uuid()) @db.Uuid
  customerId            String            @db.Uuid
  label                 String
  addressLine1          String
  addressLine2          String?
  suburb                String?
  city                  String?
  postalCode            String?
  mapUrl                String?
  /// Gate codes, dogs, who to call. Staff only, never shown to clients.
  accessNotes           String?
  lawnSizeSqm           Int?
  grassType             String?
  hasIrrigation         Boolean           @default(false)
  terrainNotes          String?
  frequency             ServiceFrequency?
  preferredDay          String?
  /// Plain field for now; becomes price-list items in Module 2.
  agreedMonthlyFeeCents Int?
  extrasNote            String?
  archivedAt            DateTime?
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  customer Customer @relation(fields: [customerId], references: [id])

  @@index([customerId])
  @@map("properties")
}
```

- [ ] **Step 2: Validate, then generate the migration SQL without touching the database**

```bash
cd "C:/Users/compl/Desktop/Lloyd/Claude/ACE Website/ace-erp"
npm run db:validate
mkdir -p packages/core/prisma/migrations/20261118120000_customers
git show HEAD:packages/core/prisma/schema.prisma > "$TEMP/old-schema.prisma"
cd packages/core
npx prisma migrate diff --from-schema "$TEMP/old-schema.prisma" --to-schema prisma/schema.prisma --script > prisma/migrations/20261118120000_customers/migration.sql
```

If `--from-schema` is rejected by this Prisma version, run `npx prisma migrate diff --help` and use the flag it names for "from a schema file". Expected: the SQL file contains `CREATE TYPE`, `CREATE TABLE "customers"`, `"contacts"`, `"properties"`, `"number" SERIAL`.

- [ ] **Step 3: Append the protections to the end of that `migration.sql`**

```sql
-- ---------------------------------------------------------------------------
-- Protections (same rules as the init migration)
-- ---------------------------------------------------------------------------
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "customers", "contacts", "properties" FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE "customers_number_seq" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_display_name_not_blank" CHECK (length(btrim("displayName")) > 0);
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_fee_not_negative"
  CHECK ("agreedMonthlyFeeCents" IS NULL OR "agreedMonthlyFeeCents" >= 0);
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_lawn_not_negative"
  CHECK ("lawnSizeSqm" IS NULL OR "lawnSizeSqm" >= 0);
```

- [ ] **Step 4: Write the test harness**

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
```

`packages/core/scripts/test-db.mjs` (runs only the database tests, with the root `.env.local` loaded, and switches them on):

```js
// Runs the *.db.test.ts files against the DEVELOPMENT database. Every test runs inside a
// transaction that is rolled back, so nothing is kept. Never point this at the live database.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", "..", ".env.local") });

const require = createRequire(import.meta.url);
const vitestBin = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const result = spawnSync(process.execPath, [vitestBin, "run", ".db.test.ts"], {
  cwd: join(here, ".."),
  stdio: "inherit",
  env: { ...process.env, ACE_DB_TESTS: "1" },
});
process.exit(result.status ?? 1);
```

`packages/core/src/testing/rollback.ts`:

```ts
import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";

class Rollback extends Error {}

/** True only when `npm run test:db` switched the database tests on. CI never does. */
export const dbTestsEnabled = process.env.ACE_DB_TESTS === "1";

/**
 * Runs a test inside a database transaction and ALWAYS rolls it back, so tests leave nothing
 * behind. (Customer numbers come from a sequence, so a rolled-back test can leave a gap in the
 * numbering of the dev database. That is harmless.)
 */
export async function withRollback<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let result!: T;
  try {
    await getDb().$transaction(
      async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
```

- [ ] **Step 5: Add scripts and write the protection test**

In `packages/core/package.json` scripts add `"test:db": "node scripts/test-db.mjs"`. In root `package.json` scripts add `"test:db": "npm run test:db -w @ace/core"`.

`packages/core/src/customers/db-protection.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

describe.skipIf(!dbTestsEnabled)("customers database protections", () => {
  it("blocks the public API from reading the new tables", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    for (const table of ["customers", "contacts", "properties"]) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
      });
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("rejects an uppercase contact email", async () => {
    await expect(
      withRollback(async (tx) => {
        const customer = await tx.customer.create({
          data: { type: "PERSON", displayName: "Protection Test" },
        });
        await tx.contact.create({
          data: { customerId: customer.id, name: "X", email: "UPPER@Example.com" },
        });
      }),
    ).rejects.toThrow();
  });

  it("rejects a blank customer name and a negative fee", async () => {
    await expect(
      withRollback((tx) => tx.customer.create({ data: { type: "PERSON", displayName: "   " } })),
    ).rejects.toThrow();
    await expect(
      withRollback(async (tx) => {
        const c = await tx.customer.create({ data: { type: "PERSON", displayName: "Fee Test" } });
        await tx.property.create({
          data: {
            customerId: c.id,
            label: "x",
            addressLine1: "1 Test St",
            agreedMonthlyFeeCents: -1,
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("numbers customers upwards", async () => {
    await withRollback(async (tx) => {
      const a = await tx.customer.create({ data: { type: "PERSON", displayName: "A Test" } });
      const b = await tx.customer.create({ data: { type: "PERSON", displayName: "B Test" } });
      expect(b.number).toBeGreaterThan(a.number);
    });
  });
});
```

- [ ] **Step 6: Apply the migration to the dev database, regenerate the client, run the tests**

```bash
cd "C:/Users/compl/Desktop/Lloyd/Claude/ACE Website/ace-erp"
npm run db:deploy
npm run db:generate
npm run test:db
```

Expected: migration `20261118120000_customers` applied; 4 tests pass. (`db:deploy` uses `DIRECT_URL` from `.env.local`.)

- [ ] **Step 7: Check CI-safe tests still skip the DB, then commit**

```bash
npm run test   # database tests must show as skipped
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add customer, contact and property tables with protections" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure rules (phone, number, validation, crew column list)

**Files:**

- Create: `packages/core/src/customers/phone.ts`, `phone.test.ts`, `number.ts`, `number.test.ts`, `schemas.ts`, `schemas.test.ts`, `views.ts`, `views.test.ts`

**Interfaces:**

- Produces:
  - `normalisePhone(input: string): string | null`
  - `formatCustomerNumber(n: number): string`, `parseCustomerNumber(s: string): number | null`
  - `parseRandToCents(input: string): number | null`, `formatCentsForInput(cents: number): string`
  - `customerSchema`, `contactSchema`, `propertySchema` (zod; **input = form strings, output = clean values**) and `type CustomerInput`, `ContactInput`, `PropertyInput`
  - `CUSTOMER_SOURCES`, `SERVICE_FREQUENCIES`, `WEEKDAYS` (string tuples)
  - `CREW_CUSTOMER_SELECT` (Prisma select) and `CREW_PROPERTY_FIELDS`

- [ ] **Step 1: Write the failing tests**

`phone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it.each([
    ["082 123 4567", "+27821234567"],
    ["0821234567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["27821234567", "+27821234567"],
    ["0027 82 123 4567", "+27821234567"],
    ["(011) 123-4567", "+27111234567"],
  ])("reads %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "123", "abc", "+44 20 7946 0958", "082 123 456", "082 123 45678"])(
    "rejects %s",
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );
});
```

`number.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCustomerNumber, parseCustomerNumber } from "./number";

describe("customer numbers", () => {
  it("formats with padding", () => {
    expect(formatCustomerNumber(1)).toBe("C-0001");
    expect(formatCustomerNumber(12345)).toBe("C-12345");
  });
  it("parses what staff type", () => {
    expect(parseCustomerNumber("C-0012")).toBe(12);
    expect(parseCustomerNumber(" c0012 ")).toBe(12);
    expect(parseCustomerNumber("12")).toBeNull();
    expect(parseCustomerNumber("Mrs Smith")).toBeNull();
  });
});
```

`schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  contactSchema,
  customerSchema,
  formatCentsForInput,
  parseRandToCents,
  propertySchema,
} from "./schemas";

describe("parseRandToCents", () => {
  it.each([
    ["850", 85000],
    ["R 850.50", 85050],
    ["1,250.50", 125050],
    ["R 1 250,50", 125050],
    ["0", 0],
  ])("reads %s", (input, cents) => expect(parseRandToCents(input)).toBe(cents));

  it.each(["", "abc", "-5", "12.345", "1.2.3"])("rejects %s", (input) =>
    expect(parseRandToCents(input)).toBeNull(),
  );

  it("formats cents for an edit box", () => {
    expect(formatCentsForInput(85000)).toBe("850.00");
    expect(formatCentsForInput(125050)).toBe("1250.50");
  });
});

describe("customerSchema", () => {
  it("accepts the minimum and applies defaults", () => {
    const c = customerSchema.parse({ type: "PERSON", displayName: "  Jane Doe " });
    expect(c.displayName).toBe("Jane Doe");
    expect(c.status).toBe("ACTIVE");
    expect(c.consentGiven).toBe(false);
    expect(c.notes).toBeUndefined();
  });
  it("turns blank optional boxes into undefined and checkbox 'on' into true", () => {
    const c = customerSchema.parse({
      type: "COMPANY",
      displayName: "Body Corp",
      notes: "",
      source: "",
      consentGiven: "on",
    });
    expect(c.notes).toBeUndefined();
    expect(c.source).toBeUndefined();
    expect(c.consentGiven).toBe(true);
  });
  it("rejects a blank name and an unknown status", () => {
    expect(customerSchema.safeParse({ type: "PERSON", displayName: "  " }).success).toBe(false);
    expect(
      customerSchema.safeParse({ type: "PERSON", displayName: "A", status: "ARCHIVED" }).success,
    ).toBe(false);
  });
});

describe("contactSchema", () => {
  it("lowercases email and normalises phone", () => {
    const c = contactSchema.parse({
      name: "Sam",
      email: " Sam@Example.COM ",
      phone: "082 123 4567",
    });
    expect(c.email).toBe("sam@example.com");
    expect(c.phone).toBe("+27821234567");
  });
  it("needs an email or a phone", () => {
    const r = contactSchema.safeParse({ name: "Sam" });
    expect(r.success).toBe(false);
  });
  it("rejects a bad phone and portal access without an email", () => {
    expect(contactSchema.safeParse({ name: "Sam", phone: "12" }).success).toBe(false);
    expect(
      contactSchema.safeParse({ name: "Sam", phone: "0821234567", portalAccess: "on" }).success,
    ).toBe(false);
  });
});

describe("propertySchema", () => {
  it("converts the fee to cents and numbers to integers", () => {
    const p = propertySchema.parse({
      label: "Main",
      addressLine1: "1 Test Street",
      monthlyFee: "R 850",
      lawnSizeSqm: "320",
      frequency: "WEEKLY",
      hasIrrigation: "on",
    });
    expect(p.monthlyFee).toBe(85000);
    expect(p.lawnSizeSqm).toBe(320);
    expect(p.hasIrrigation).toBe(true);
  });
  it("only accepts http(s) map links and known frequencies", () => {
    const base = { label: "Main", addressLine1: "1 Test Street" };
    expect(propertySchema.safeParse({ ...base, mapUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      propertySchema.safeParse({ ...base, mapUrl: "https://maps.google.com/?q=1" }).success,
    ).toBe(true);
    expect(propertySchema.safeParse({ ...base, frequency: "DAILY" }).success).toBe(false);
  });
});
```

`views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CREW_CUSTOMER_SELECT } from "./views";

function keysOf(select: unknown, out: string[] = []): string[] {
  if (select && typeof select === "object") {
    for (const [key, value] of Object.entries(select)) {
      if (key === "select") keysOf(value, out);
      else if (key === "where" || key === "orderBy") continue;
      else {
        out.push(key);
        keysOf(value, out);
      }
    }
  }
  return out;
}

describe("crew view", () => {
  it("selects exactly the allowed columns and nothing restricted", () => {
    const keys = keysOf(CREW_CUSTOMER_SELECT).sort();
    expect(keys).toEqual(
      [
        "accessNotes",
        "addressLine1",
        "addressLine2",
        "city",
        "displayName",
        "id",
        "id",
        "label",
        "mapUrl",
        "number",
        "postalCode",
        "properties",
        "status",
        "suburb",
      ].sort(),
    );
    for (const restricted of [
      "email",
      "phone",
      "contacts",
      "notes",
      "billingLine1",
      "agreedMonthlyFeeCents",
      "extrasNote",
      "companyName",
      "registrationNumber",
      "consentAt",
      "terrainNotes",
    ]) {
      expect(keys).not.toContain(restricted);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd packages/core && npx vitest run src/customers`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the implementations**

`phone.ts`:

```ts
/**
 * Turns a South African phone number into +27XXXXXXXXX, or null if it is not one.
 * Accepts "082 123 4567", "+27 82 123 4567", "0027...", "(011) 123-4567".
 */
export function normalisePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? `+${digits}` : null;
}
```

`number.ts`:

```ts
export function formatCustomerNumber(n: number): string {
  return `C-${String(n).padStart(4, "0")}`;
}

/** "C-0012" or "c0012" -> 12. Anything else -> null. */
export function parseCustomerNumber(input: string): number | null {
  const match = /^C-?(\d{1,9})$/i.exec(input.trim());
  return match?.[1] ? Number(match[1]) : null;
}
```

`schemas.ts`:

```ts
import { z } from "zod";
import { normalisePhone } from "./phone";

export const CUSTOMER_SOURCES = ["REFERRAL", "GOOGLE", "FACEBOOK", "DIRECTORY", "OTHER"] as const;
export const SERVICE_FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ONCE_OFF"] as const;
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// --- building blocks. Form boxes arrive as strings; blank means "not given". ---------------

const tooLong = (max: number) => `Keep this under ${max} characters.`;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const requiredText = (what: string, max: number) =>
  z.string().trim().min(1, `Enter ${what}.`).max(max, tooLong(max));

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(values).optional());

const email = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return undefined;
    const normalised = normalisePhone(v);
    if (!normalised) {
      ctx.addIssue({ code: "custom", message: "Enter a South African number, e.g. 082 123 4567." });
      return z.NEVER;
    }
    return normalised;
  })
  .optional();

const wholeNumber = (max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return undefined;
      if (!/^\d+$/.test(v) || Number(v) > max) {
        ctx.addIssue({ code: "custom", message: `Enter a whole number up to ${max}.` });
        return z.NEVER;
      }
      return Number(v);
    })
    .optional();

/** "850", "R 850.50", "1,250.50", "R 1 250,50" -> cents. Anything else -> null. */
export function parseRandToCents(input: string): number | null {
  let s = input.trim().replace(/^R\s*/i, "").replace(/\s/g, "");
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match?.[1]) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 125050 -> "1250.50", for putting a stored fee back into an edit box. */
export function formatCentsForInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const rand = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return undefined;
    const cents = parseRandToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rand, e.g. 850 or 850.50." });
      return z.NEVER;
    }
    return cents;
  })
  .optional();

const webLink = z
  .string()
  .trim()
  .max(500, tooLong(500))
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Use a full link starting with https://")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

// --- the three records ------------------------------------------------------------------------

export const customerSchema = z.object({
  type: z.enum(["PERSON", "COMPANY"]),
  displayName: requiredText("a name", 120),
  companyName: text(120),
  registrationNumber: text(40),
  status: z.enum(["LEAD", "ACTIVE", "PAUSED"]).default("ACTIVE"),
  billingLine1: text(150),
  billingLine2: text(150),
  billingSuburb: text(80),
  billingCity: text(80),
  billingPostalCode: text(10),
  source: optionalEnum(CUSTOMER_SOURCES),
  sourceNote: text(200),
  notes: text(2000),
  consentGiven: checkbox,
  consentSource: text(40),
  consentNote: text(300),
});
export type CustomerInput = z.output<typeof customerSchema>;

export const contactSchema = z
  .object({
    name: requiredText("a name", 120),
    role: text(60),
    email,
    phone,
    receivesQuotes: checkbox,
    receivesInvoices: checkbox,
    portalAccess: checkbox,
  })
  .refine((c) => Boolean(c.email || c.phone), {
    message: "Add an email or a phone number.",
    path: ["email"],
  })
  .refine((c) => !c.portalAccess || Boolean(c.email), {
    message: "Portal access needs an email address.",
    path: ["email"],
  });
export type ContactInput = z.output<typeof contactSchema>;

export const propertySchema = z.object({
  label: requiredText("a label, e.g. Main house", 80),
  addressLine1: requiredText("a street address", 150),
  addressLine2: text(150),
  suburb: text(80),
  city: text(80),
  postalCode: text(10),
  mapUrl: webLink,
  accessNotes: text(1000),
  lawnSizeSqm: wholeNumber(1_000_000),
  grassType: text(60),
  hasIrrigation: checkbox,
  terrainNotes: text(1000),
  frequency: optionalEnum(SERVICE_FREQUENCIES),
  preferredDay: optionalEnum(WEEKDAYS),
  /** Typed in rand ("R 850"); the validated value is whole CENTS. */
  monthlyFee: rand,
  extrasNote: text(500),
});
export type PropertyInput = z.output<typeof propertySchema>;
```

`views.ts`:

```ts
import type { Prisma } from "../generated/prisma/client";

/**
 * Everything a CREW member may see. This is the ONLY query shape used for crew, so a new screen
 * cannot leak a field by accident. NO fees, emails, phones, billing details or notes.
 */
export const CREW_CUSTOMER_SELECT = {
  id: true,
  number: true,
  displayName: true,
  status: true,
  properties: {
    where: { archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      addressLine1: true,
      addressLine2: true,
      suburb: true,
      city: true,
      postalCode: true,
      mapUrl: true,
      accessNotes: true,
    },
  },
} as const satisfies Prisma.CustomerSelect;

export type CrewCustomer = Prisma.CustomerGetPayload<{ select: typeof CREW_CUSTOMER_SELECT }>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd packages/core && npx vitest run src/customers`
Expected: all PASS. If `contactSchema.safeParse({ name: "Sam", phone: "0821234567", portalAccess: "on" })` unexpectedly passes, check the second `.refine` ordering.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add customer validation, phone and number rules and the crew-safe view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Data layer for customers (create, edit, archive, search, crew view, duplicates)

**Files:**

- Create: `packages/core/src/customers/access.ts`, `store.ts`, `mappers.ts`, `customers.ts`, `duplicates.ts`, `index.ts`, `customers.db.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: Task 1 models and `withRollback`; Task 2 schemas, `parseCustomerNumber`, `CREW_CUSTOMER_SELECT`; existing `recordAudit`.
- Produces (all exported from `@ace/core`):
  - `type Actor = { id: string; role: StaffRole; ip?: string; userAgent?: string }`
  - `ForbiddenError`, `DomainError` (safe to show to users), `MANAGEMENT = ["OWNER","MANAGER"]`, `OWNER_ONLY = ["OWNER"]`, `assertRole(actor, allowed)`
  - `type Store = Pick<Db, "customer"|"contact"|"property"|"auditLog"|"staffUser">`, `inTx(fn, opts?)`
  - `createCustomer(store, actor, { customer, contact, property? }) => { id, number }`
  - `updateCustomer(store, actor, id, input: CustomerInput) => void`
  - `archiveCustomer(store, actor, id)`, `restoreCustomer(store, actor, id)`
  - `listCustomers(store, actor, { q?, status?: CustomerStatus | "ALL", page?, pageSize? }) => { items, total, page, pageSize }`
  - `getCustomer(store, actor, id)` (full, with contacts and active properties) `| null`
  - `listCustomersForCrew(store, actor, { q?, page? })`, `getCustomerForCrew(store, actor, id)`
  - `listCustomerActivity(store, actor, id)`
  - `findDuplicateContacts(store, actor, { emails, phones, excludeCustomerId? }) => DuplicateMatch[]`
  - `customerData`, `contactData`, `propertyData` mappers

- [ ] **Step 1: Write the access, store and mapper files**

`access.ts`:

```ts
import type { StaffRole } from "../generated/prisma/enums";

/** Who is asking. Built by the app from the signed-in staff member. */
export type Actor = { id: string; role: StaffRole; ip?: string; userAgent?: string };

/** The actor's role does not allow this. The app turns it into the /forbidden page. */
export class ForbiddenError extends Error {
  constructor() {
    super("You do not have access to this.");
    this.name = "ForbiddenError";
  }
}

/** A problem the user can fix. The message is safe to show on screen. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export const MANAGEMENT: readonly StaffRole[] = ["OWNER", "MANAGER"];
export const OWNER_ONLY: readonly StaffRole[] = ["OWNER"];

export function assertRole(actor: Actor, allowed: readonly StaffRole[]): void {
  if (!allowed.includes(actor.role)) throw new ForbiddenError();
}
```

`store.ts`:

```ts
import { recordAudit } from "../audit";
import { getDb, type Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { DomainError, type Actor } from "./access";

/** What the customer functions need. Works with the normal connection or a transaction. */
export type Store = Pick<Db, "customer" | "contact" | "property" | "auditLog" | "staffUser">;

/** Runs several writes as one all-or-nothing step. */
export function inTx<T>(
  fn: (tx: Store) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return getDb().$transaction((tx) => fn(tx), {
    timeout: opts.timeoutMs ?? 15_000,
    maxWait: 10_000,
  });
}

/** Writes an audit line about a customer. `after` must hold field NAMES and ids, never personal values. */
export async function logCustomerEvent(
  store: Store,
  actor: Actor,
  action: string,
  customerId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action,
    entityType: "customer",
    entityId: customerId,
    ...(after !== undefined ? { after } : {}),
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
}

/** Names of the fields whose value differs. Used for audit lines (names only, never values). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const norm = (v: unknown) => (v === undefined ? null : v);
  return Object.keys(after).filter((key) => !Object.is(norm(before[key]), norm(after[key])));
}

/** Throws a friendly error if the customer is missing or anonymised. */
export async function requireEditableCustomer(store: Store, customerId: string) {
  const customer = await store.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  return customer;
}
```

`mappers.ts`:

```ts
import type { ContactInput, CustomerInput, PropertyInput } from "./schemas";

/** Validated form values -> database columns (blank becomes null). */
export function customerData(c: CustomerInput) {
  return {
    type: c.type,
    displayName: c.displayName,
    companyName: c.companyName ?? null,
    registrationNumber: c.registrationNumber ?? null,
    status: c.status,
    billingLine1: c.billingLine1 ?? null,
    billingLine2: c.billingLine2 ?? null,
    billingSuburb: c.billingSuburb ?? null,
    billingCity: c.billingCity ?? null,
    billingPostalCode: c.billingPostalCode ?? null,
    source: c.source ?? null,
    sourceNote: c.sourceNote ?? null,
    notes: c.notes ?? null,
    consentSource: c.consentSource ?? null,
    consentNote: c.consentNote ?? null,
  };
}

export function contactData(c: ContactInput) {
  return {
    name: c.name,
    role: c.role ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    receivesQuotes: c.receivesQuotes,
    receivesInvoices: c.receivesInvoices,
    portalAccess: c.portalAccess,
  };
}

export function propertyData(p: PropertyInput) {
  return {
    label: p.label,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2 ?? null,
    suburb: p.suburb ?? null,
    city: p.city ?? null,
    postalCode: p.postalCode ?? null,
    mapUrl: p.mapUrl ?? null,
    accessNotes: p.accessNotes ?? null,
    lawnSizeSqm: p.lawnSizeSqm ?? null,
    grassType: p.grassType ?? null,
    hasIrrigation: p.hasIrrigation,
    terrainNotes: p.terrainNotes ?? null,
    frequency: p.frequency ?? null,
    preferredDay: p.preferredDay ?? null,
    agreedMonthlyFeeCents: p.monthlyFee ?? null,
    extrasNote: p.extrasNote ?? null,
  };
}
```

- [ ] **Step 2: Write the failing database tests** — `customers.db.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { ForbiddenError, type Actor } from "./access";
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  getCustomerForCrew,
  listCustomers,
  listCustomersForCrew,
  restoreCustomer,
  updateCustomer,
} from "./customers";
import { findDuplicateContacts } from "./duplicates";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const crew: Actor = { id: randomUUID(), role: "CREW" };

const customer = (over: Record<string, string> = {}) =>
  customerSchema.parse({ type: "PERSON", displayName: "Test Person", ...over });
const contact = () =>
  contactSchema.parse({ name: "Test Contact", email: "test@example.com", phone: "082 123 4567" });
const property = () =>
  propertySchema.parse({
    label: "Main",
    addressLine1: "1 Testing Street",
    suburb: "Testville",
    frequency: "WEEKLY",
    // An unusual amount, so the "crew must not see fees" test cannot match by accident
    // (ids contain digits, so a round number like 850 could appear inside one).
    monthlyFee: "851.37",
    accessNotes: "Gate code 1234",
    extrasNote: "Weed treatment",
  });

describe.skipIf(!dbTestsEnabled)("customers data layer", () => {
  it("creates a customer with contact and property and audits it without personal values", async () => {
    await withRollback(async (tx) => {
      const { id, number } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: contact(),
        property: property(),
      });
      const full = await getCustomer(tx, manager, id);
      expect(full?.contacts).toHaveLength(1);
      expect(full?.properties).toHaveLength(1);
      expect(full?.properties[0]?.agreedMonthlyFeeCents).toBe(85137);

      const audit = await tx.auditLog.findMany({ where: { entityId: id } });
      expect(audit.map((a) => a.action)).toEqual(["customer.created"]);
      const text = JSON.stringify(audit);
      expect(text).not.toContain("Test Person");
      expect(text).not.toContain("test@example.com");
      expect(number).toBeGreaterThan(0);
    });
  });

  it("records which fields changed on update, never their values", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: contact(),
      });
      await updateCustomer(
        tx,
        manager,
        id,
        customer({ displayName: "Renamed Person", notes: "secret note" }),
      );
      const entry = await tx.auditLog.findFirst({
        where: { entityId: id, action: "customer.updated" },
      });
      const after = entry?.after as { changed: string[] };
      expect(after.changed.sort()).toEqual(["displayName", "notes"]);
      expect(JSON.stringify(entry)).not.toContain("Renamed");
      expect(JSON.stringify(entry)).not.toContain("secret");
    });
  });

  it("archives and restores to the previous status", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer({ status: "PAUSED" }),
        contact: contact(),
      });
      await archiveCustomer(tx, manager, id);
      expect((await getCustomer(tx, manager, id))?.status).toBe("ARCHIVED");
      await restoreCustomer(tx, manager, id);
      const back = await getCustomer(tx, manager, id);
      expect(back?.status).toBe("PAUSED");
      expect(back?.archivedAt).toBeNull();
    });
  });

  it("lists, searches and hides archived by default", async () => {
    await withRollback(async (tx) => {
      const a = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Zzqx Alpha" }),
        contact: contact(),
        property: property(),
      });
      const b = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Zzqx Beta" }),
        contact: contactSchema.parse({ name: "B", email: "beta@example.com" }),
      });
      await archiveCustomer(tx, manager, b.id);

      const byName = await listCustomers(tx, manager, { q: "zzqx" });
      expect(byName.items.map((c) => c.id)).toEqual([a.id]);

      const withArchived = await listCustomers(tx, manager, { q: "zzqx", status: "ALL" });
      expect(withArchived.total).toBe(2);

      const byNumber = await listCustomers(tx, manager, {
        q: `C-${String(a.number).padStart(4, "0")}`,
      });
      expect(byNumber.items.map((c) => c.id)).toContain(a.id);

      const byPhone = await listCustomers(tx, manager, { q: "0821234567" });
      expect(byPhone.items.map((c) => c.id)).toContain(a.id);

      const byStreet = await listCustomers(tx, manager, { q: "testing street" });
      expect(byStreet.items.map((c) => c.id)).toContain(a.id);
    });
  });

  it("gives crew only the safe view and refuses crew the full list", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Crewview Person", notes: "internal" }),
        contact: contact(),
        property: property(),
      });
      const view = await getCustomerForCrew(tx, crew, id);
      expect(Object.keys(view ?? {}).sort()).toEqual([
        "displayName",
        "id",
        "number",
        "properties",
        "status",
      ]);
      expect(Object.keys(view?.properties[0] ?? {}).sort()).toEqual([
        "accessNotes",
        "addressLine1",
        "addressLine2",
        "city",
        "id",
        "label",
        "mapUrl",
        "postalCode",
        "suburb",
      ]);
      const text = JSON.stringify(view);
      for (const secret of [
        "test@example.com",
        "+27821234567",
        "85137",
        "851.37",
        "Weed",
        "internal",
      ]) {
        expect(text).not.toContain(secret);
      }
      const list = await listCustomersForCrew(tx, crew, { q: "crewview" });
      expect(list.items).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain("test@example.com");

      await expect(listCustomers(tx, crew, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCustomer(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createCustomer(tx, crew, { customer: customer(), contact: contact() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("finds duplicate contacts by email or phone", async () => {
    await withRollback(async (tx) => {
      const first = await createCustomer(tx, manager, { customer: customer(), contact: contact() });
      const matches = await findDuplicateContacts(tx, manager, {
        emails: ["test@example.com"],
        phones: ["+27829999999"],
      });
      expect(matches.map((m) => m.customerId)).toContain(first.id);
      expect(matches[0]?.reason).toBe("email");
      const none = await findDuplicateContacts(tx, manager, {
        emails: ["test@example.com"],
        phones: [],
        excludeCustomerId: first.id,
      });
      expect(none).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm run test:db`
Expected: FAIL (`./customers` and `./duplicates` do not exist).

- [ ] **Step 4: Implement `customers.ts`**

```ts
import type { CustomerStatus, Prisma } from "../generated/prisma/client";
import { assertRole, MANAGEMENT, type Actor } from "./access";
import { contactData, customerData, propertyData } from "./mappers";
import { parseCustomerNumber } from "./number";
import type { ContactInput, CustomerInput, PropertyInput } from "./schemas";
import { changedFields, logCustomerEvent, requireEditableCustomer, type Store } from "./store";
import { CREW_CUSTOMER_SELECT } from "./views";

export type NewCustomerInput = {
  customer: CustomerInput;
  contact: ContactInput;
  property?: PropertyInput | undefined;
};

export async function createCustomer(store: Store, actor: Actor, input: NewCustomerInput) {
  assertRole(actor, MANAGEMENT);
  const { customer, contact, property } = input;
  const created = await store.customer.create({
    data: {
      ...customerData(customer),
      consentAt: customer.consentGiven ? new Date() : null,
      createdById: actor.id,
      contacts: { create: [contactData(contact)] },
      ...(property ? { properties: { create: [propertyData(property)] } } : {}),
    },
    select: { id: true, number: true },
  });
  await logCustomerEvent(store, actor, "customer.created", created.id, {
    number: created.number,
    type: customer.type,
    status: customer.status,
  });
  return created;
}

export async function updateCustomer(
  store: Store,
  actor: Actor,
  id: string,
  input: CustomerInput,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  const data = {
    ...customerData(input),
    // An archived customer stays archived; restoring is a separate action.
    status: existing.status === "ARCHIVED" ? ("ARCHIVED" as const) : input.status,
  };
  const consentAt = input.consentGiven ? (existing.consentAt ?? new Date()) : null;
  const changed = changedFields(existing, { ...data, consentAt });
  await store.customer.update({ where: { id }, data: { ...data, consentAt } });
  await logCustomerEvent(store, actor, "customer.updated", id, { changed });
}

export async function archiveCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  if (existing.status === "ARCHIVED") return;
  await store.customer.update({
    where: { id },
    data: { status: "ARCHIVED", statusBeforeArchive: existing.status, archivedAt: new Date() },
  });
  await logCustomerEvent(store, actor, "customer.archived", id);
}

export async function restoreCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  if (existing.status !== "ARCHIVED") return;
  await store.customer.update({
    where: { id },
    data: {
      status: existing.statusBeforeArchive ?? "ACTIVE",
      statusBeforeArchive: null,
      archivedAt: null,
    },
  });
  await logCustomerEvent(store, actor, "customer.restored", id);
}

// --- searching ----------------------------------------------------------------------------------

export type ListQuery = {
  q?: string | undefined;
  status?: CustomerStatus | "ALL" | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

/** "082 123", "0821234567" -> a fragment comparable with stored +27 numbers. */
function phoneSearchTerm(q: string): string | null {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.startsWith("0") ? `27${digits.slice(1)}` : digits;
}

function buildWhere(query: ListQuery): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];
  if (query.status === "ALL") {
    // show everything
  } else if (query.status) {
    and.push({ status: query.status });
  } else {
    and.push({ status: { not: "ARCHIVED" } });
  }

  const term = query.q?.trim();
  if (term) {
    const contains = { contains: term, mode: "insensitive" } as const;
    const number = parseCustomerNumber(term);
    const phone = phoneSearchTerm(term);
    const or: Prisma.CustomerWhereInput[] = [
      { displayName: contains },
      { companyName: contains },
      {
        contacts: {
          some: { OR: [{ name: contains }, { email: { contains: term.toLowerCase() } }] },
        },
      },
      { properties: { some: { OR: [{ addressLine1: contains }, { suburb: contains }] } } },
    ];
    if (number !== null) or.push({ number });
    if (phone) or.push({ contacts: { some: { phone: { contains: phone } } } });
    and.push({ OR: or });
  }
  return { AND: and };
}

const LIST_SELECT = {
  id: true,
  number: true,
  displayName: true,
  type: true,
  status: true,
  contacts: {
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { name: true, email: true, phone: true },
  },
  _count: { select: { properties: true } },
} as const satisfies Prisma.CustomerSelect;

function paging(query: { page?: number | undefined; pageSize?: number | undefined }) {
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function listCustomers(store: Store, actor: Actor, query: ListQuery) {
  assertRole(actor, MANAGEMENT);
  const { page, pageSize, skip } = paging(query);
  const where = buildWhere(query);
  const items = await store.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: LIST_SELECT,
  });
  const total = await store.customer.count({ where });
  return { items, total, page, pageSize };
}

export async function getCustomer(store: Store, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  return store.customer.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      properties: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
    },
  });
}

// --- crew ---------------------------------------------------------------------------------------

const CREW_VISIBLE: Prisma.CustomerWhereInput = { status: { in: ["ACTIVE", "PAUSED"] } };

export async function listCustomersForCrew(
  store: Store,
  _actor: Actor,
  query: { q?: string | undefined; page?: number | undefined },
) {
  const { page, pageSize, skip } = paging(query);
  const term = query.q?.trim();
  const where: Prisma.CustomerWhereInput = {
    AND: [
      CREW_VISIBLE,
      ...(term
        ? [
            {
              OR: [
                { displayName: { contains: term, mode: "insensitive" as const } },
                {
                  properties: {
                    some: {
                      OR: [
                        { addressLine1: { contains: term, mode: "insensitive" as const } },
                        { suburb: { contains: term, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
  const items = await store.customer.findMany({
    where,
    orderBy: { displayName: "asc" },
    skip,
    take: pageSize,
    select: CREW_CUSTOMER_SELECT,
  });
  const total = await store.customer.count({ where });
  return { items, total, page, pageSize };
}

export async function getCustomerForCrew(store: Store, _actor: Actor, id: string) {
  return store.customer.findFirst({
    where: { id, ...CREW_VISIBLE },
    select: CREW_CUSTOMER_SELECT,
  });
}

// --- activity -----------------------------------------------------------------------------------

export async function listCustomerActivity(store: Store, actor: Actor, id: string, limit = 100) {
  assertRole(actor, MANAGEMENT);
  const entries = await store.auditLog.findMany({
    where: { entityType: "customer", entityId: id },
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, action: true, actorId: true, after: true },
  });
  const ids = [...new Set(entries.map((e) => e.actorId).filter((v): v is string => Boolean(v)))];
  const staff = await store.staffUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return entries.map((e) => ({
    ...e,
    actorName: e.actorId ? (names.get(e.actorId) ?? "Staff") : "System",
  }));
}

export type { CustomerStatus } from "../generated/prisma/client";
```

(`DomainError` is NOT imported or re-exported here: the barrel already exports it from `access.ts`, and a second export of the same name would be a type error. In the import line at the top of this file, use `import { assertRole, MANAGEMENT, type Actor } from "./access";`.)

- [ ] **Step 5: Implement `duplicates.ts` and the barrel**

`duplicates.ts`:

```ts
import type { Prisma } from "../generated/prisma/client";
import { assertRole, MANAGEMENT, type Actor } from "./access";
import type { Store } from "./store";

export type DuplicateMatch = {
  customerId: string;
  number: number;
  displayName: string;
  reason: "email" | "phone";
};

/** Warns about other customers sharing an email or phone. A warning only, never a block. */
export async function findDuplicateContacts(
  store: Store,
  actor: Actor,
  input: { emails: string[]; phones: string[]; excludeCustomerId?: string | undefined },
): Promise<DuplicateMatch[]> {
  assertRole(actor, MANAGEMENT);
  const emails = input.emails.filter(Boolean);
  const phones = input.phones.filter(Boolean);
  if (emails.length === 0 && phones.length === 0) return [];

  const or: Prisma.ContactWhereInput[] = [];
  if (emails.length) or.push({ email: { in: emails } });
  if (phones.length) or.push({ phone: { in: phones } });

  const rows = await store.contact.findMany({
    where: {
      OR: or,
      customer: { anonymisedAt: null },
      ...(input.excludeCustomerId ? { customerId: { not: input.excludeCustomerId } } : {}),
    },
    select: {
      email: true,
      customer: { select: { id: true, number: true, displayName: true } },
    },
    take: 20,
  });

  const seen = new Map<string, DuplicateMatch>();
  for (const row of rows) {
    if (seen.has(row.customer.id)) continue;
    seen.set(row.customer.id, {
      customerId: row.customer.id,
      number: row.customer.number,
      displayName: row.customer.displayName,
      reason: row.email && emails.includes(row.email) ? "email" : "phone",
    });
  }
  return [...seen.values()];
}
```

`index.ts` (grows in later tasks):

```ts
export * from "./access";
export * from "./customers";
export * from "./duplicates";
export * from "./mappers";
export * from "./number";
export * from "./phone";
export * from "./schemas";
export * from "./store";
export * from "./views";
```

In `packages/core/src/index.ts` append: `export * from "./customers";`

- [ ] **Step 6: Run everything**

```bash
npm run test:db
npm run typecheck && npm run lint && npm run test && npm run format
```

Expected: all database tests PASS; CI-style `npm run test` skips them.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add customer data layer with role checks, search and crew view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Data layer for contacts and properties

**Files:**

- Create: `packages/core/src/customers/contacts.ts`, `properties.ts`, `contacts-properties.db.test.ts`
- Modify: `packages/core/src/customers/index.ts`

**Interfaces:**

- Consumes: Task 3 (`Store`, `Actor`, `assertRole`, `MANAGEMENT`, `DomainError`, `requireEditableCustomer`, `logCustomerEvent`, `changedFields`, mappers, `createCustomer`).
- Produces: `addContact(store, actor, customerId, input: ContactInput) => { id }`, `updateContact(store, actor, contactId, input)`, `removeContact(store, actor, contactId)`, `addProperty(store, actor, customerId, input: PropertyInput) => { id }`, `updateProperty(store, actor, propertyId, input)`, `archiveProperty(store, actor, propertyId)`.

- [ ] **Step 1: Write the failing tests** — `contacts-properties.db.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { DomainError, type Actor } from "./access";
import { addContact, removeContact, updateContact } from "./contacts";
import { createCustomer, getCustomer } from "./customers";
import { addProperty, archiveProperty, updateProperty } from "./properties";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const base = () => ({
  customer: customerSchema.parse({ type: "PERSON", displayName: "Child Test" }),
  contact: contactSchema.parse({ name: "First", email: "first@example.com" }),
});

describe.skipIf(!dbTestsEnabled)("contacts and properties", () => {
  it("adds, updates and removes contacts but keeps at least one", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const second = await addContact(
        tx,
        manager,
        id,
        contactSchema.parse({ name: "Second", phone: "0821234567" }),
      );
      expect((await getCustomer(tx, manager, id))?.contacts).toHaveLength(2);

      await updateContact(
        tx,
        manager,
        second.id,
        contactSchema.parse({ name: "Second B", phone: "0821234567" }),
      );
      const updated = await tx.contact.findUnique({ where: { id: second.id } });
      expect(updated?.name).toBe("Second B");

      await removeContact(tx, manager, second.id);
      const remaining = (await getCustomer(tx, manager, id))?.contacts ?? [];
      expect(remaining).toHaveLength(1);
      await expect(removeContact(tx, manager, remaining[0]!.id)).rejects.toBeInstanceOf(
        DomainError,
      );

      const actions = (
        await tx.auditLog.findMany({ where: { entityId: id }, orderBy: { at: "asc" } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "customer.contact_added",
          "customer.contact_updated",
          "customer.contact_removed",
        ]),
      );
      expect(JSON.stringify(await tx.auditLog.findMany({ where: { entityId: id } }))).not.toContain(
        "Second",
      );
    });
  });

  it("adds, updates and archives properties", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const p = await addProperty(
        tx,
        manager,
        id,
        propertySchema.parse({ label: "Cottage", addressLine1: "2 Test Road" }),
      );
      await updateProperty(
        tx,
        manager,
        p.id,
        propertySchema.parse({ label: "Cottage", addressLine1: "2 Test Road", monthlyFee: "400" }),
      );
      expect((await getCustomer(tx, manager, id))?.properties[0]?.agreedMonthlyFeeCents).toBe(
        40000,
      );
      await archiveProperty(tx, manager, p.id);
      expect((await getCustomer(tx, manager, id))?.properties).toHaveLength(0);
    });
  });

  it("refuses changes to a customer that does not exist", async () => {
    await withRollback(async (tx) => {
      await expect(
        addContact(
          tx,
          manager,
          randomUUID(),
          contactSchema.parse({ name: "X", email: "x@example.com" }),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test:db` (modules missing).

- [ ] **Step 3: Implement**

`contacts.ts`:

```ts
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { contactData } from "./mappers";
import type { ContactInput } from "./schemas";
import { changedFields, logCustomerEvent, requireEditableCustomer, type Store } from "./store";

export async function addContact(
  store: Store,
  actor: Actor,
  customerId: string,
  input: ContactInput,
) {
  assertRole(actor, MANAGEMENT);
  await requireEditableCustomer(store, customerId);
  const created = await store.contact.create({
    data: { customerId, ...contactData(input) },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.contact_added", customerId, {
    contactId: created.id,
  });
  return created;
}

export async function updateContact(
  store: Store,
  actor: Actor,
  contactId: string,
  input: ContactInput,
) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new DomainError("That contact could not be found.");
  await requireEditableCustomer(store, existing.customerId);
  const data = contactData(input);
  const changed = changedFields(existing, data);
  await store.contact.update({ where: { id: contactId }, data });
  await logCustomerEvent(store, actor, "customer.contact_updated", existing.customerId, {
    contactId,
    changed,
  });
}

export async function removeContact(store: Store, actor: Actor, contactId: string) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new DomainError("That contact could not be found.");
  await requireEditableCustomer(store, existing.customerId);
  const count = await store.contact.count({ where: { customerId: existing.customerId } });
  if (count <= 1) throw new DomainError("A customer needs at least one contact.");
  await store.contact.delete({ where: { id: contactId } });
  await logCustomerEvent(store, actor, "customer.contact_removed", existing.customerId, {
    contactId,
  });
}
```

`properties.ts`:

```ts
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { propertyData } from "./mappers";
import type { PropertyInput } from "./schemas";
import { changedFields, logCustomerEvent, requireEditableCustomer, type Store } from "./store";

export async function addProperty(
  store: Store,
  actor: Actor,
  customerId: string,
  input: PropertyInput,
) {
  assertRole(actor, MANAGEMENT);
  await requireEditableCustomer(store, customerId);
  const created = await store.property.create({
    data: { customerId, ...propertyData(input) },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.property_added", customerId, {
    propertyId: created.id,
  });
  return created;
}

export async function updateProperty(
  store: Store,
  actor: Actor,
  propertyId: string,
  input: PropertyInput,
) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.property.findUnique({ where: { id: propertyId } });
  if (!existing) throw new DomainError("That property could not be found.");
  await requireEditableCustomer(store, existing.customerId);
  const data = propertyData(input);
  const changed = changedFields(existing, data);
  await store.property.update({ where: { id: propertyId }, data });
  await logCustomerEvent(store, actor, "customer.property_updated", existing.customerId, {
    propertyId,
    changed,
  });
}

export async function archiveProperty(store: Store, actor: Actor, propertyId: string) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.property.findUnique({ where: { id: propertyId } });
  if (!existing) throw new DomainError("That property could not be found.");
  await requireEditableCustomer(store, existing.customerId);
  await store.property.update({ where: { id: propertyId }, data: { archivedAt: new Date() } });
  await logCustomerEvent(store, actor, "customer.property_archived", existing.customerId, {
    propertyId,
  });
}
```

Add `export * from "./contacts"; export * from "./properties";` to `customers/index.ts`.

- [ ] **Step 4: Run, then commit**

```bash
npm run test:db && npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add contact and property data layer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all database tests PASS.

---

### Task 5: Staff shell, shared form pieces and the customer list

**Files:**

- Create: `apps/admin/src/lib/actor.ts`, `apps/admin/src/lib/form.ts`, `apps/admin/src/components/form.tsx`, `apps/admin/src/app/(staff)/layout.tsx`, `apps/admin/src/app/(staff)/page.tsx`, `apps/admin/src/app/(staff)/customers/page.tsx`
- Delete: `apps/admin/src/app/page.tsx`
- Modify: `apps/admin/next.config.ts`

**Interfaces:**

- Consumes: `requireStaff`, `signOut` (`../login/actions`), `requestContext`, `inTx`, `getDb`, `listCustomers`, `listCustomersForCrew`, `formatCustomerNumber`.
- Produces:
  - `toActor(staff: StaffSession): Promise<Actor>`
  - `type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; nonce?: number; duplicates?: DuplicateMatch[] } | undefined`, `formValues(fd)`, `withPrefix(values, prefix)`, `errorsFrom(zodError, prefix?)`, `failure(error: unknown): FormState` (turns `DomainError` into a message, `ForbiddenError` into a redirect to `/forbidden`, rethrows anything else)
  - Components `TextField`, `TextAreaField`, `SelectField`, `CheckboxField`, `FormMessage`, `secondaryButtonClass`

- [ ] **Step 1: Server-action size limit for CSV upload** — in `apps/admin/next.config.ts` add inside `nextConfig`:

```ts
  experimental: {
    // The customer import accepts files up to 2 MB (plus form overhead).
    serverActions: { bodySizeLimit: "3mb" },
  },
```

- [ ] **Step 2: Helpers**

`apps/admin/src/lib/actor.ts`:

```ts
import "server-only";
import type { Actor } from "@ace/core";
import type { StaffSession } from "@/lib/auth";
import { requestContext } from "@/lib/request-context";

/** The signed-in staff member plus where the request came from, as the core functions expect. */
export async function toActor(staff: StaffSession): Promise<Actor> {
  return { id: staff.id, role: staff.role, ...(await requestContext()) };
}
```

`apps/admin/src/lib/form.ts`:

```ts
import { DomainError, ForbiddenError, type DuplicateMatch } from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";

export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /** What was typed, so a failed save does not wipe the form. */
      values?: Record<string, string>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: number;
      duplicates?: DuplicateMatch[];
    }
  | undefined;

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** { contact_name: "x" } with prefix "contact_" -> { name: "x" } */
export function withPrefix(values: Record<string, string>, prefix: string): Record<string, string> {
  if (!prefix) return values;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

/** First message for each field, keyed with the prefix the form used. */
export function errorsFrom(error: z.ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(z.flattenError(error).fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) out[`${prefix}${field}`] = first;
  }
  return out;
}

/** Turns a failed save into something the form can show. Call from a catch block. */
export function failure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError)
    return { error: error.message, ...(values ? { values } : {}), nonce: Date.now() };
  throw error;
}
```

- [ ] **Step 3: Shared form components** — `apps/admin/src/components/form.tsx`

```tsx
import { inputClass } from "./auth-card";

export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-full border border-forest/30 px-5 py-2.5 font-display text-sm font-semibold text-forest transition-colors hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";

type Common = {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
};

function Wrap({
  label,
  required,
  hint,
  error,
  children,
}: Omit<Common, "name"> & { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-charcoal">
      {label}
      {required ? (
        <span aria-hidden="true" className="text-ochre">
          {" "}
          *
        </span>
      ) : null}
      {children}
      {hint ? (
        <span className="mt-1 block text-xs font-normal text-charcoal/60">{hint}</span>
      ) : null}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TextField({
  type = "text",
  defaultValue,
  inputMode,
  autoComplete,
  autoFocus,
  ...common
}: Common & {
  type?: string;
  defaultValue?: string | undefined;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal" | "url";
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <Wrap {...common}>
      <input
        name={common.name}
        type={type}
        defaultValue={defaultValue}
        required={common.required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      />
    </Wrap>
  );
}

export function TextAreaField({
  defaultValue,
  rows = 3,
  ...common
}: Common & { defaultValue?: string | undefined; rows?: number }) {
  return (
    <Wrap {...common}>
      <textarea
        name={common.name}
        defaultValue={defaultValue}
        rows={rows}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      />
    </Wrap>
  );
}

export function SelectField({
  options,
  defaultValue,
  ...common
}: Common & {
  options: readonly { value: string; label: string }[];
  defaultValue?: string | undefined;
}) {
  return (
    <Wrap {...common}>
      <select
        name={common.name}
        defaultValue={defaultValue ?? ""}
        required={common.required}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  );
}

export function CheckboxField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-charcoal">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 rounded border-charcoal/30 text-forest focus:ring-forest/30"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-charcoal/60">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormMessage({ error }: { error?: string | undefined }) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
    >
      {error}
    </p>
  ) : null;
}
```

- [ ] **Step 4: Replace the home page with the staff shell**

Delete `apps/admin/src/app/page.tsx` (`git rm`). Create `apps/admin/src/app/(staff)/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";

export default async function Home() {
  await requireStaff();
  redirect("/customers");
}
```

`apps/admin/src/app/(staff)/layout.tsx`:

```tsx
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";

// The layout gives every staff page the same header. It is NOT the security check:
// each page and action calls requireStaff() itself.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="min-h-screen">
      <header className="border-b border-charcoal/10 bg-white/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-6 text-sm font-semibold">
            <span className="font-display text-forest">ACE</span>
            <Link href="/customers" className="text-charcoal/80 hover:text-forest">
              Customers
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-charcoal/60 sm:inline">
              {staff.name} ({staff.role.toLowerCase()})
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full border border-forest/30 px-4 py-1.5 font-display text-xs font-semibold text-forest hover:bg-forest hover:text-cream"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: The customer list page** — `apps/admin/src/app/(staff)/customers/page.tsx`

```tsx
import {
  formatCustomerNumber,
  getDb,
  listCustomers,
  listCustomersForCrew,
  type CustomerStatus,
} from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";

type Search = { q?: string; status?: string; page?: string; imported?: string };

const STATUSES = ["LEAD", "ACTIVE", "PAUSED", "ARCHIVED"] as const;

const badge: Record<string, string> = {
  LEAD: "bg-ochre/15 text-ochre",
  ACTIVE: "bg-forest/10 text-forest",
  PAUSED: "bg-charcoal/10 text-charcoal/70",
  ARCHIVED: "bg-charcoal/10 text-charcoal/50",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const q = sp.q?.trim() ?? "";
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const isCrew = staff.role === "CREW";

  const status = STATUSES.find((s) => s === sp.status) ?? (sp.status === "ALL" ? "ALL" : undefined);
  const result = isCrew
    ? await listCustomersForCrew(getDb(), actor, { q, page })
    : await listCustomers(getDb(), actor, {
        q,
        page,
        status: status as CustomerStatus | "ALL" | undefined,
      });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sp.status) params.set("status", sp.status);
    params.set("page", String(p));
    return `/customers?${params.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Customers</h1>
        {isCrew ? null : (
          <div className="flex gap-2">
            <Link href="/customers/import" className={secondaryButtonClass}>
              Import CSV
            </Link>
            <Link
              href="/customers/new"
              className="inline-flex items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
            >
              Add customer
            </Link>
          </div>
        )}
      </div>

      {sp.imported ? (
        <p role="status" className="mt-4 rounded-lg bg-forest/10 px-3 py-2 text-sm text-forest">
          Import finished: {Number(sp.imported) || 0} customers added.
        </p>
      ) : null}

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={
            isCrew ? "Search name or address" : "Search name, number, phone, email, address"
          }
          aria-label="Search customers"
          className={`${inputClass} mt-0 flex-1 basis-64`}
        />
        {isCrew ? null : (
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            aria-label="Status"
            className={`${inputClass} mt-0 w-auto`}
          >
            <option value="">Not archived</option>
            <option value="ALL">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      {result.items.length === 0 ? (
        <p className="mt-10 text-center text-charcoal/60">
          {q ? "No customers match that search." : "No customers yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {result.items.map((c) => {
            const first = "contacts" in c ? c.contacts[0] : undefined;
            const places = "_count" in c ? c._count.properties : c.properties.length;
            return (
              <li key={c.id}>
                <Link
                  href={`/customers/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span>
                    <span className="font-semibold text-forest">{c.displayName}</span>
                    <span className="ml-2 text-xs text-charcoal/50">
                      {formatCustomerNumber(c.number)}
                    </span>
                    {first ? (
                      <span className="block text-sm text-charcoal/60">
                        {[first.name, first.phone].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-charcoal/60">
                    <span>
                      {places} {places === 1 ? "property" : "properties"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 font-semibold ${badge[c.status] ?? ""}`}
                    >
                      {c.status.toLowerCase()}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={link(page - 1)} className="text-forest hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-charcoal/60">
            Page {page} of {pages} ({result.total} customers)
          </span>
          {page < pages ? (
            <Link href={link(page + 1)} className="text-forest hover:underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
```

Also export `CustomerStatus` type from core: in `customers/customers.ts` add `export type { CustomerStatus } from "../generated/prisma/client";`.

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm run lint && npm run format
npm run dev:admin
```

In the browser (signed in as the owner): `/` redirects to `/customers`; the header shows name and role; the empty state reads "No customers yet."; search box and status filter render; the layout looks right at phone width (use the browser's mobile preset).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add staff shell and customer list with search" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Add-customer form with duplicate warning

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/_components/customer-fields.tsx`, `contact-fields.tsx`, `property-fields.tsx`, `apps/admin/src/app/(staff)/customers/new/page.tsx`, `new/new-customer-form.tsx`, `apps/admin/src/app/(staff)/customers/actions.ts`

**Interfaces:**

- Consumes: Task 5 helpers/components; core `customerSchema`, `contactSchema`, `propertySchema`, `createCustomer`, `findDuplicateContacts`, `inTx`, `CUSTOMER_SOURCES`, `SERVICE_FREQUENCIES`, `WEEKDAYS`.
- Produces: field groups `CustomerFields({ values, errors })`, `ContactFields({ values, errors, prefix? })`, `PropertyFields({ values, errors, prefix? })` (each: `values: Record<string, string>`, `errors: Record<string, string>`); server action `createCustomerAction(prev: FormState, formData: FormData): Promise<FormState>` in `customers/actions.ts` (later tasks add more actions to the same file).

- [ ] **Step 1: Field groups**

`_components/customer-fields.tsx`:

```tsx
import { CUSTOMER_SOURCES } from "@ace/core";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; editing?: boolean };

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function CustomerFields({ values: v, errors: e, editing }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Type"
          name="type"
          defaultValue={v.type ?? "PERSON"}
          options={[
            { value: "PERSON", label: "Homeowner / person" },
            { value: "COMPANY", label: "Company, body corporate or agent" },
          ]}
          error={e.type}
        />
        <SelectField
          label="Status"
          name="status"
          defaultValue={v.status ?? "ACTIVE"}
          options={[
            { value: "LEAD", label: "Lead" },
            { value: "ACTIVE", label: "Active" },
            { value: "PAUSED", label: "Paused" },
          ]}
          error={e.status}
        />
      </div>
      <TextField
        label="Name"
        name="displayName"
        required
        defaultValue={v.displayName}
        error={e.displayName}
        autoFocus={!editing}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Company name"
          name="companyName"
          defaultValue={v.companyName}
          error={e.companyName}
        />
        <TextField
          label="Registration number"
          name="registrationNumber"
          defaultValue={v.registrationNumber}
          error={e.registrationNumber}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="font-display text-sm font-semibold text-forest">Billing address</legend>
        <TextField
          label="Street address"
          name="billingLine1"
          defaultValue={v.billingLine1}
          error={e.billingLine1}
        />
        <TextField
          label="Address line 2"
          name="billingLine2"
          defaultValue={v.billingLine2}
          error={e.billingLine2}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Suburb"
            name="billingSuburb"
            defaultValue={v.billingSuburb}
            error={e.billingSuburb}
          />
          <TextField
            label="City"
            name="billingCity"
            defaultValue={v.billingCity}
            error={e.billingCity}
          />
          <TextField
            label="Postal code"
            name="billingPostalCode"
            inputMode="numeric"
            defaultValue={v.billingPostalCode}
            error={e.billingPostalCode}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Where did they find us?"
          name="source"
          defaultValue={v.source ?? ""}
          options={[
            { value: "", label: "Not recorded" },
            ...CUSTOMER_SOURCES.map((s) => ({ value: s, label: label(s) })),
          ]}
          error={e.source}
        />
        <TextField
          label="Source note"
          name="sourceNote"
          defaultValue={v.sourceNote}
          error={e.sourceNote}
          hint="e.g. who referred them"
        />
      </div>
      <TextAreaField
        label="Internal notes"
        name="notes"
        defaultValue={v.notes}
        error={e.notes}
        hint="Only staff managers see this."
      />

      <fieldset className="space-y-3 rounded-xl bg-cream/60 p-4">
        <legend className="px-1 font-display text-sm font-semibold text-forest">
          Privacy (POPIA)
        </legend>
        <CheckboxField
          label="They agreed that we may keep their details"
          name="consentGiven"
          defaultChecked={v.consentGiven === "on"}
          hint="Tick when they have said yes, in person, by message or by accepting a quote."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="How they agreed"
            name="consentSource"
            defaultValue={v.consentSource}
            error={e.consentSource}
            hint="e.g. WhatsApp, in person"
          />
          <TextField
            label="Consent note"
            name="consentNote"
            defaultValue={v.consentNote}
            error={e.consentNote}
          />
        </div>
      </fieldset>
    </div>
  );
}
```

`_components/contact-fields.tsx`:

```tsx
import { CheckboxField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; prefix?: string };

export function ContactFields({ values: v, errors: e, prefix = "" }: Props) {
  const n = (name: string) => `${prefix}${name}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Contact name"
          name={n("name")}
          required
          defaultValue={v[n("name")]}
          error={e[n("name")]}
        />
        <TextField
          label="Role"
          name={n("role")}
          defaultValue={v[n("role")]}
          error={e[n("role")]}
          hint="Owner, trustee, managing agent, tenant..."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Email"
          name={n("email")}
          type="email"
          inputMode="email"
          autoComplete="off"
          defaultValue={v[n("email")]}
          error={e[n("email")]}
        />
        <TextField
          label="Phone / WhatsApp"
          name={n("phone")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={v[n("phone")]}
          error={e[n("phone")]}
        />
      </div>
      <div className="space-y-2">
        <CheckboxField
          label="Receives quotes"
          name={n("receivesQuotes")}
          defaultChecked={v[n("receivesQuotes")] ? v[n("receivesQuotes")] === "on" : true}
        />
        <CheckboxField
          label="Receives invoices"
          name={n("receivesInvoices")}
          defaultChecked={v[n("receivesInvoices")] ? v[n("receivesInvoices")] === "on" : true}
        />
        <CheckboxField
          label="Can use the client portal"
          name={n("portalAccess")}
          defaultChecked={v[n("portalAccess")] === "on"}
          hint="Their email becomes their login when the portal opens."
        />
      </div>
    </div>
  );
}
```

Note: for an unticked checkbox the key is absent, so "unset" cannot be told from "unchecked" after a failed save; the `? ... : true` default only applies to a brand-new form (no `values`). To keep a deliberate untick after an error, `failure()` callers always pass `values`, and the form re-renders with `values` populated; an absent `receivesQuotes` key then means unchecked. Handle this by having each form pass `values={state.values ?? initial}` where `initial` for a new form is `{ receivesQuotes: "on", receivesInvoices: "on" }` (see Step 3) and change the two lines above to `defaultChecked={v[n("receivesQuotes")] === "on"}`.

`_components/property-fields.tsx`:

```tsx
import { SERVICE_FREQUENCIES, WEEKDAYS } from "@ace/core";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; prefix?: string };

const freq: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  ONCE_OFF: "Once-off",
};

export function PropertyFields({ values: v, errors: e, prefix = "" }: Props) {
  const n = (name: string) => `${prefix}${name}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Label"
          name={n("label")}
          defaultValue={v[n("label")] ?? "Main property"}
          error={e[n("label")]}
        />
        <TextField
          label="Map link"
          name={n("mapUrl")}
          type="url"
          inputMode="url"
          defaultValue={v[n("mapUrl")]}
          error={e[n("mapUrl")]}
          hint="A Google Maps link"
        />
      </div>
      <TextField
        label="Street address"
        name={n("addressLine1")}
        defaultValue={v[n("addressLine1")]}
        error={e[n("addressLine1")]}
      />
      <TextField
        label="Address line 2"
        name={n("addressLine2")}
        defaultValue={v[n("addressLine2")]}
        error={e[n("addressLine2")]}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Suburb"
          name={n("suburb")}
          defaultValue={v[n("suburb")]}
          error={e[n("suburb")]}
        />
        <TextField label="City" name={n("city")} defaultValue={v[n("city")]} error={e[n("city")]} />
        <TextField
          label="Postal code"
          name={n("postalCode")}
          inputMode="numeric"
          defaultValue={v[n("postalCode")]}
          error={e[n("postalCode")]}
        />
      </div>
      <TextAreaField
        label="Access notes"
        name={n("accessNotes")}
        defaultValue={v[n("accessNotes")]}
        error={e[n("accessNotes")]}
        hint="Gate code, dogs, who to call. Staff only."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Lawn size (m²)"
          name={n("lawnSizeSqm")}
          inputMode="numeric"
          defaultValue={v[n("lawnSizeSqm")]}
          error={e[n("lawnSizeSqm")]}
        />
        <TextField
          label="Grass type"
          name={n("grassType")}
          defaultValue={v[n("grassType")]}
          error={e[n("grassType")]}
        />
        <div className="pt-6">
          <CheckboxField
            label="Has irrigation"
            name={n("hasIrrigation")}
            defaultChecked={v[n("hasIrrigation")] === "on"}
          />
        </div>
      </div>
      <TextAreaField
        label="Terrain notes"
        name={n("terrainNotes")}
        defaultValue={v[n("terrainNotes")]}
        error={e[n("terrainNotes")]}
        hint="Slopes, hedges, difficult areas"
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Service"
          name={n("frequency")}
          defaultValue={v[n("frequency")] ?? ""}
          options={[
            { value: "", label: "Not set" },
            ...SERVICE_FREQUENCIES.map((f) => ({ value: f, label: freq[f] ?? f })),
          ]}
          error={e[n("frequency")]}
        />
        <SelectField
          label="Preferred day"
          name={n("preferredDay")}
          defaultValue={v[n("preferredDay")] ?? ""}
          options={[
            { value: "", label: "No preference" },
            ...WEEKDAYS.map((d) => ({ value: d, label: d })),
          ]}
          error={e[n("preferredDay")]}
        />
        <TextField
          label="Agreed monthly fee (R)"
          name={n("monthlyFee")}
          inputMode="decimal"
          defaultValue={v[n("monthlyFee")]}
          error={e[n("monthlyFee")]}
          hint="e.g. 850 or 850.50"
        />
      </div>
      <TextField
        label="Optional extras"
        name={n("extrasNote")}
        defaultValue={v[n("extrasNote")]}
        error={e[n("extrasNote")]}
        hint="e.g. weed treatment"
      />
    </div>
  );
}
```

- [ ] **Step 2: The server action** — `apps/admin/src/app/(staff)/customers/actions.ts`

```ts
"use server";

import {
  contactSchema,
  createCustomer,
  customerSchema,
  findDuplicateContacts,
  inTx,
  propertySchema,
} from "@ace/core";
import { redirect } from "next/navigation";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, withPrefix, type FormState } from "@/lib/form";

const MANAGEMENT = ["OWNER", "MANAGER"] as const;

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);

  const customer = customerSchema.safeParse(values);
  const contact = contactSchema.safeParse(withPrefix(values, "contact_"));
  const wantsProperty = Boolean(values.property_addressLine1?.trim());
  const property = wantsProperty ? propertySchema.safeParse(withPrefix(values, "property_")) : null;

  const fieldErrors = {
    ...(customer.success ? {} : errorsFrom(customer.error)),
    ...(contact.success ? {} : errorsFrom(contact.error, "contact_")),
    ...(property && !property.success ? errorsFrom(property.error, "property_") : {}),
  };
  if (!customer.success || !contact.success || (property && !property.success)) {
    return { fieldErrors, values, nonce: Date.now() };
  }

  let id: string;
  try {
    const result = await inTx(async (tx) => {
      // A warning, not a block: the same email or phone on another customer.
      if (values.confirmDuplicates !== "1") {
        const duplicates = await findDuplicateContacts(tx, actor, {
          emails: contact.data.email ? [contact.data.email] : [],
          phones: contact.data.phone ? [contact.data.phone] : [],
        });
        if (duplicates.length > 0) return { duplicates } as const;
      }
      const created = await createCustomer(tx, actor, {
        customer: customer.data,
        contact: contact.data,
        property: property?.success ? property.data : undefined,
      });
      return { id: created.id } as const;
    });
    if ("duplicates" in result) return { duplicates: result.duplicates, values, nonce: Date.now() };
    id = result.id;
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${id}`);
}
```

- [ ] **Step 3: The page and the form**

`new/page.tsx`:

```tsx
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  await requireStaff(["OWNER", "MANAGER"]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Add customer</h1>
      <NewCustomerForm />
    </div>
  );
}
```

`new/new-customer-form.tsx`:

```tsx
"use client";

import { formatCustomerNumber } from "@ace/core";
import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { ContactFields } from "../_components/contact-fields";
import { CustomerFields } from "../_components/customer-fields";
import { PropertyFields } from "../_components/property-fields";
import { createCustomerAction } from "../actions";

const INITIAL = {
  receivesQuotes: "on",
  receivesInvoices: "on",
  contact_receivesQuotes: "on",
  contact_receivesInvoices: "on",
};

export function NewCustomerForm() {
  const [state, action, pending] = useActionState(createCustomerAction, undefined);
  const values = state?.values ?? INITIAL;
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="mt-6 space-y-8">
      <div key={state?.nonce ?? "initial"} className="space-y-8">
        <CustomerFields values={values} errors={errors} />
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-forest">First contact</h2>
          <ContactFields values={values} errors={errors} prefix="contact_" />
        </section>
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-forest">
            First property (optional)
          </h2>
          <PropertyFields values={values} errors={errors} prefix="property_" />
        </section>
      </div>

      {state?.duplicates?.length ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-ochre/10 p-4 text-sm text-charcoal ring-1 ring-ochre/30"
        >
          <p className="font-semibold">This email or phone is already on another customer:</p>
          <ul className="list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.customerId}>
                <Link
                  href={`/customers/${d.customerId}`}
                  className="text-forest underline"
                  target="_blank"
                >
                  {d.displayName} ({formatCustomerNumber(d.number)})
                </Link>{" "}
                matched by {d.reason}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmDuplicates" value="1" required />
            Save anyway, this is a different customer
          </label>
        </div>
      ) : null}

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save customer"}
      </button>
    </form>
  );
}
```

Change the two `defaultChecked` lines in `contact-fields.tsx` to `v[n("receivesQuotes")] === "on"` and `v[n("receivesInvoices")] === "on"` as described in Step 1.

- [ ] **Step 4: Verify in the browser** (dev server running, signed in as owner; made-up data only)

1. `/customers/new` → press Save with nothing filled → field errors appear on name, contact name and email/phone; typed values are kept.
2. Fill: type Homeowner, name "Test Garden One", contact "Test Contact", phone `082 123 4567`, property street "1 Testing Street", fee `850`. Save → redirected to `/customers/<id>` (page built in Task 7; a 404 here is acceptable until then).
3. Add a second customer with the same phone → the yellow duplicate warning appears with a link; tick "Save anyway" and save.
4. Open `/customers`: both customers listed; search `0821234567` finds both.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add the add-customer form with duplicate warning" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Customer page: overview, edit, archive and restore

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/[id]/page.tsx`, `[id]/overview-tab.tsx`, `[id]/edit-customer-form.tsx`, `[id]/crew-view.tsx`
- Modify: `apps/admin/src/app/(staff)/customers/actions.ts`

**Interfaces:**

- Consumes: Task 6 field groups and actions file; core `getCustomer`, `getCustomerForCrew`, `updateCustomer`, `archiveCustomer`, `restoreCustomer`, `formatCustomerNumber`, `formatZAR`.
- Produces: route `/customers/[id]?tab=overview|contacts|properties|activity` (Tasks 8-9 and 11 fill the other tabs; this task renders a placeholder paragraph for them); actions `updateCustomerAction(prev, formData)`, `archiveCustomerAction(formData)`, `restoreCustomerAction(formData)`.

- [ ] **Step 1: Add the actions** (append to `customers/actions.ts`; add `archiveCustomer`, `restoreCustomer`, `updateCustomer` to the `@ace/core` import and `import { z } from "zod";`)

```ts
const idSchema = z.uuid();

export async function updateCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: "Something went wrong. Refresh the page and try again." };

  const customer = customerSchema.safeParse(values);
  if (!customer.success)
    return { fieldErrors: errorsFrom(customer.error), values, nonce: Date.now() };

  try {
    await inTx((tx) => updateCustomer(tx, actor, id.data, customer.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${id.data}`);
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => archiveCustomer(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${id}`);
}

export async function restoreCustomerAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => restoreCustomer(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${id}`);
}
```

- [ ] **Step 2: The page** — `[id]/page.tsx`

```tsx
import { formatCustomerNumber, getCustomer, getCustomerForCrew, getDb } from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { CrewView } from "./crew-view";
import { OverviewTab } from "./overview-tab";

type Search = { tab?: string; edit?: string; add?: string };
const TABS = ["overview", "contacts", "properties", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const actor = await toActor(staff);

  if (staff.role === "CREW") {
    const view = await getCustomerForCrew(getDb(), actor, id);
    if (!view) notFound();
    return <CrewView customer={view} />;
  }

  const customer = await getCustomer(getDb(), actor, id);
  if (!customer) notFound();
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "overview";

  return (
    <div>
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">{customer.displayName}</h1>
        <span className="text-sm text-charcoal/50">{formatCustomerNumber(customer.number)}</span>
        <span className="rounded-full bg-forest/10 px-2.5 py-1 text-xs font-semibold text-forest">
          {customer.status.toLowerCase()}
        </span>
      </div>

      <nav
        className="mt-6 flex gap-1 border-b border-charcoal/10 text-sm font-semibold"
        aria-label="Customer sections"
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/customers/${id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`px-4 py-2 ${t === tab ? "border-b-2 border-forest text-forest" : "text-charcoal/60 hover:text-forest"}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" ? (
          <OverviewTab
            customer={customer}
            editing={sp.edit === "1"}
            isOwner={staff.role === "OWNER"}
          />
        ) : (
          <p className="text-charcoal/60">This section is built in a later step.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Overview, edit form and crew view**

`[id]/overview-tab.tsx`:

```tsx
import type { getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { archiveCustomerAction, restoreCustomerAction } from "../actions";
import { EditCustomerForm } from "./edit-customer-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm text-charcoal/60">{label}</dt>
      <dd className="text-sm text-charcoal sm:col-span-2">{value || "—"}</dd>
    </div>
  );
}

export function OverviewTab({
  customer: c,
  editing,
  isOwner,
}: {
  customer: Customer;
  editing: boolean;
  isOwner: boolean;
}) {
  if (editing && !c.anonymisedAt) return <EditCustomerForm customer={c} />;

  const billing = [
    c.billingLine1,
    c.billingLine2,
    c.billingSuburb,
    c.billingCity,
    c.billingPostalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const archived = c.status === "ARCHIVED";

  return (
    <div className="space-y-8">
      <dl className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 px-4 ring-1 ring-charcoal/10">
        <Row
          label="Type"
          value={c.type === "COMPANY" ? "Company / body corporate / agent" : "Homeowner / person"}
        />
        <Row label="Company" value={c.companyName} />
        <Row label="Registration number" value={c.registrationNumber} />
        <Row label="Billing address" value={billing} />
        <Row
          label="Source"
          value={[c.source?.toLowerCase(), c.sourceNote].filter(Boolean).join(" · ")}
        />
        <Row label="Internal notes" value={c.notes} />
        <Row
          label="Details held with consent"
          value={
            c.consentAt
              ? `Yes, ${c.consentAt.toLocaleDateString("en-ZA")}${c.consentSource ? ` (${c.consentSource})` : ""}`
              : "Not recorded"
          }
        />
      </dl>

      {c.anonymisedAt ? (
        <p className="text-sm text-charcoal/60">
          This customer was anonymised on {c.anonymisedAt.toLocaleDateString("en-ZA")}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link href={`/customers/${c.id}?tab=overview&edit=1`} className={secondaryButtonClass}>
            Edit details
          </Link>
          <form action={archived ? restoreCustomerAction : archiveCustomerAction}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className={secondaryButtonClass}>
              {archived ? "Restore customer" : "Archive customer"}
            </button>
          </form>
        </div>
      )}
      {isOwner && !c.anonymisedAt ? (
        <p className="text-xs text-charcoal/50">Owner tools are added in a later step.</p>
      ) : null}
    </div>
  );
}
```

(The last line is a temporary placeholder; Task 11 replaces it.)

`[id]/edit-customer-form.tsx`:

```tsx
"use client";

import type { getCustomer } from "@ace/core";
import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { updateCustomerAction } from "../actions";
import { CustomerFields } from "../_components/customer-fields";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

function toValues(c: Customer): Record<string, string> {
  const v: Record<string, string> = {
    type: c.type,
    displayName: c.displayName,
    status: c.status === "ARCHIVED" ? "ACTIVE" : c.status,
  };
  const optional = {
    companyName: c.companyName,
    registrationNumber: c.registrationNumber,
    billingLine1: c.billingLine1,
    billingLine2: c.billingLine2,
    billingSuburb: c.billingSuburb,
    billingCity: c.billingCity,
    billingPostalCode: c.billingPostalCode,
    source: c.source,
    sourceNote: c.sourceNote,
    notes: c.notes,
    consentSource: c.consentSource,
    consentNote: c.consentNote,
  };
  for (const [key, value] of Object.entries(optional)) if (value) v[key] = value;
  if (c.consentAt) v.consentGiven = "on";
  return v;
}

export function EditCustomerForm({ customer }: { customer: Customer }) {
  const [state, action, pending] = useActionState(updateCustomerAction, undefined);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={customer.id} />
      <div key={state?.nonce ?? "initial"}>
        <CustomerFields
          values={state?.values ?? toValues(customer)}
          errors={state?.fieldErrors ?? {}}
          editing
        />
      </div>
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link
          href={`/customers/${customer.id}`}
          className="self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
```

Archived customers: the status select defaults to ACTIVE in the form, but `updateCustomer` ignores the status of an archived customer (it stays archived), so saving details never un-archives.

`[id]/crew-view.tsx`:

```tsx
import { formatCustomerNumber, type CrewCustomer } from "@ace/core";
import Link from "next/link";

export function CrewView({ customer }: { customer: CrewCustomer }) {
  return (
    <div>
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">
        {customer.displayName}{" "}
        <span className="text-sm font-normal text-charcoal/50">
          {formatCustomerNumber(customer.number)}
        </span>
      </h1>
      <ul className="mt-6 space-y-4">
        {customer.properties.map((p) => (
          <li key={p.id} className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
            <p className="font-semibold text-forest">{p.label}</p>
            <p className="text-sm text-charcoal">
              {[p.addressLine1, p.addressLine2, p.suburb, p.city, p.postalCode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {p.mapUrl ? (
              <a
                href={p.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm text-forest underline"
              >
                Open map
              </a>
            ) : null}
            {p.accessNotes ? (
              <p className="mt-2 rounded-lg bg-cream/70 p-3 text-sm text-charcoal">
                {p.accessNotes}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Export `CrewCustomer` from core: it is already exported through `views.ts` via the barrel.

- [ ] **Step 4: Verify in the browser** (made-up data)

Open a customer from the list: header shows name, number and status; Overview shows details; **Edit details** saves and returns; **Archive** → status chip shows archived and button turns to **Restore**; list hides it unless Status = All; **Restore** returns the earlier status. Tabs other than Overview show the placeholder text. Try `/customers/not-a-uuid` → 404.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add customer page with overview, edit, archive and restore" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Contacts tab

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx`, `[id]/contact-form.tsx`
- Modify: `[id]/page.tsx` (render the tab), `customers/actions.ts`

**Interfaces:**

- Consumes: `ContactFields`, `addContact`, `updateContact`, `removeContact`, `findDuplicateContacts`, `contactSchema`, `Customer` type from Task 7.
- Produces: actions `saveContactAction(prev, formData)` (hidden `customerId`; hidden `contactId` means update) and `removeContactAction(formData)`.

- [ ] **Step 1: Actions** (append; add `addContact`, `updateContact`, `removeContact` to the core import)

```ts
export async function saveContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const customerId = idSchema.safeParse(values.customerId);
  if (!customerId.success)
    return { error: "Something went wrong. Refresh the page and try again." };
  const contactId = values.contactId ? idSchema.safeParse(values.contactId) : null;
  if (contactId && !contactId.success)
    return { error: "Something went wrong. Refresh the page and try again." };

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };

  try {
    const outcome = await inTx(async (tx) => {
      if (values.confirmDuplicates !== "1") {
        const duplicates = await findDuplicateContacts(tx, actor, {
          emails: parsed.data.email ? [parsed.data.email] : [],
          phones: parsed.data.phone ? [parsed.data.phone] : [],
          excludeCustomerId: customerId.data,
        });
        if (duplicates.length > 0) return { duplicates } as const;
      }
      if (contactId?.success) await updateContact(tx, actor, contactId.data, parsed.data);
      else await addContact(tx, actor, customerId.data, parsed.data);
      return { saved: true } as const;
    });
    if ("duplicates" in outcome)
      return { duplicates: outcome.duplicates, values, nonce: Date.now() };
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${customerId.data}?tab=contacts`);
}

export async function removeContactAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const contactId = idSchema.parse(formData.get("contactId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  try {
    await inTx((tx) => removeContact(tx, actor, contactId));
  } catch (error) {
    // e.g. "A customer needs at least one contact." Show it on the page.
    const state = failure(error);
    redirect(
      `/customers/${customerId}?tab=contacts&error=${encodeURIComponent(state?.error ?? "Could not remove that contact.")}`,
    );
  }
  redirect(`/customers/${customerId}?tab=contacts`);
}
```

Add `error?: string` to the `Search` type in `[id]/page.tsx` and pass `notice={sp.error}` to the tab. (A message from the URL is shown as plain text only, never as HTML.)

- [ ] **Step 2: The form** — `[id]/contact-form.tsx`

```tsx
"use client";

import { formatCustomerNumber } from "@ace/core";
import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { ContactFields } from "../_components/contact-fields";
import { saveContactAction } from "../actions";

type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  receivesQuotes: boolean;
  receivesInvoices: boolean;
  portalAccess: boolean;
};

function toValues(c?: ContactRow): Record<string, string> {
  if (!c) return { receivesQuotes: "on", receivesInvoices: "on" };
  const v: Record<string, string> = { name: c.name };
  if (c.role) v.role = c.role;
  if (c.email) v.email = c.email;
  if (c.phone) v.phone = c.phone;
  if (c.receivesQuotes) v.receivesQuotes = "on";
  if (c.receivesInvoices) v.receivesInvoices = "on";
  if (c.portalAccess) v.portalAccess = "on";
  return v;
}

export function ContactForm({ customerId, contact }: { customerId: string; contact?: ContactRow }) {
  const [state, action, pending] = useActionState(saveContactAction, undefined);
  return (
    <form action={action} className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10">
      <input type="hidden" name="customerId" value={customerId} />
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}
      <div key={state?.nonce ?? "initial"}>
        <ContactFields
          values={state?.values ?? toValues(contact)}
          errors={state?.fieldErrors ?? {}}
        />
      </div>
      {state?.duplicates?.length ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-ochre/10 p-4 text-sm ring-1 ring-ochre/30"
        >
          <p className="font-semibold">This email or phone is already on another customer:</p>
          <ul className="list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.customerId}>
                <Link
                  href={`/customers/${d.customerId}`}
                  target="_blank"
                  className="text-forest underline"
                >
                  {d.displayName} ({formatCustomerNumber(d.number)})
                </Link>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmDuplicates" value="1" required /> Save anyway
          </label>
        </div>
      ) : null}
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save contact"}
        </button>
        <Link
          href={`/customers/${customerId}?tab=contacts`}
          className="self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: The tab** — `[id]/contacts-tab.tsx`

```tsx
import type { getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { removeContactAction } from "../actions";
import { ContactForm } from "./contact-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

export function ContactsTab({
  customer,
  edit,
  add,
  notice,
}: {
  customer: Customer;
  edit?: string | undefined;
  add: boolean;
  notice?: string | undefined;
}) {
  const editing = customer.contacts.find((c) => c.id === edit);
  const locked = Boolean(customer.anonymisedAt);

  if (add) return <ContactForm customerId={customer.id} />;
  if (editing) return <ContactForm customerId={customer.id} contact={editing} />;

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {notice}
        </p>
      ) : null}
      <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
        {customer.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold text-forest">
                {c.name}
                {c.role ? (
                  <span className="ml-2 text-sm font-normal text-charcoal/60">{c.role}</span>
                ) : null}
              </p>
              <p className="text-sm text-charcoal/70">
                {[c.email, c.phone].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-charcoal/50">
                {[
                  c.receivesQuotes && "quotes",
                  c.receivesInvoices && "invoices",
                  c.portalAccess && "portal",
                ]
                  .filter(Boolean)
                  .join(" · ") || "no messages"}
              </p>
            </div>
            {locked ? null : (
              <div className="flex gap-2">
                <Link
                  href={`/customers/${customer.id}?tab=contacts&edit=${c.id}`}
                  className={secondaryButtonClass}
                >
                  Edit
                </Link>
                <form action={removeContactAction}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <button type="submit" className={secondaryButtonClass}>
                    Remove
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
      {locked ? null : (
        <Link
          href={`/customers/${customer.id}?tab=contacts&add=1`}
          className={secondaryButtonClass}
        >
          Add contact
        </Link>
      )}
    </div>
  );
}
```

In `[id]/page.tsx` replace the placeholder branch for `tab === "contacts"` with `<ContactsTab customer={customer} edit={sp.edit} add={sp.add === "1"} notice={sp.error} />` (import it).

- [ ] **Step 4: Verify in the browser** — Contacts tab lists the first contact; **Add contact** with a bad phone shows the error and keeps the form text; add a second contact; **Edit** changes the role; **Remove** the second contact works; **Remove** on the last one shows "A customer needs at least one contact."

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add contacts tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Properties tab

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/[id]/properties-tab.tsx`, `[id]/property-form.tsx`
- Modify: `[id]/page.tsx`, `customers/actions.ts`

**Interfaces:**

- Consumes: `PropertyFields`, `addProperty`, `updateProperty`, `archiveProperty`, `propertySchema`, `formatCentsForInput`, `formatZAR`.
- Produces: actions `savePropertyAction(prev, formData)` (hidden `customerId`; hidden `propertyId` means update) and `archivePropertyAction(formData)`.

- [ ] **Step 1: Actions** (append; add `addProperty`, `updateProperty`, `archiveProperty` to the core import)

```ts
export async function savePropertyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const customerId = idSchema.safeParse(values.customerId);
  if (!customerId.success)
    return { error: "Something went wrong. Refresh the page and try again." };
  const propertyId = values.propertyId ? idSchema.safeParse(values.propertyId) : null;
  if (propertyId && !propertyId.success)
    return { error: "Something went wrong. Refresh the page and try again." };

  const parsed = propertySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };

  try {
    await inTx((tx) =>
      propertyId?.success
        ? updateProperty(tx, actor, propertyId.data, parsed.data)
        : addProperty(tx, actor, customerId.data, parsed.data),
    );
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${customerId.data}?tab=properties`);
}

export async function archivePropertyAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const propertyId = idSchema.parse(formData.get("propertyId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  try {
    await inTx((tx) => archiveProperty(tx, actor, propertyId));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${customerId}?tab=properties`);
}
```

- [ ] **Step 2: The form** — `[id]/property-form.tsx`

```tsx
"use client";

import { formatCentsForInput } from "@ace/core";
import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { PropertyFields } from "../_components/property-fields";
import { savePropertyAction } from "../actions";

export type PropertyRow = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string | null;
  city: string | null;
  postalCode: string | null;
  mapUrl: string | null;
  accessNotes: string | null;
  lawnSizeSqm: number | null;
  grassType: string | null;
  hasIrrigation: boolean;
  terrainNotes: string | null;
  frequency: string | null;
  preferredDay: string | null;
  agreedMonthlyFeeCents: number | null;
  extrasNote: string | null;
};

function toValues(p?: PropertyRow): Record<string, string> {
  if (!p) return {};
  const v: Record<string, string> = { label: p.label, addressLine1: p.addressLine1 };
  const optional: Record<string, string | number | null> = {
    addressLine2: p.addressLine2,
    suburb: p.suburb,
    city: p.city,
    postalCode: p.postalCode,
    mapUrl: p.mapUrl,
    accessNotes: p.accessNotes,
    lawnSizeSqm: p.lawnSizeSqm,
    grassType: p.grassType,
    terrainNotes: p.terrainNotes,
    frequency: p.frequency,
    preferredDay: p.preferredDay,
    monthlyFee:
      p.agreedMonthlyFeeCents === null ? null : formatCentsForInput(p.agreedMonthlyFeeCents),
    extrasNote: p.extrasNote,
  };
  for (const [key, value] of Object.entries(optional))
    if (value !== null && value !== "") v[key] = String(value);
  if (p.hasIrrigation) v.hasIrrigation = "on";
  return v;
}

export function PropertyForm({
  customerId,
  property,
}: {
  customerId: string;
  property?: PropertyRow;
}) {
  const [state, action, pending] = useActionState(savePropertyAction, undefined);
  return (
    <form action={action} className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10">
      <input type="hidden" name="customerId" value={customerId} />
      {property ? <input type="hidden" name="propertyId" value={property.id} /> : null}
      <div key={state?.nonce ?? "initial"}>
        <PropertyFields
          values={state?.values ?? toValues(property)}
          errors={state?.fieldErrors ?? {}}
        />
      </div>
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save property"}
        </button>
        <Link
          href={`/customers/${customerId}?tab=properties`}
          className="self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: The tab** — `[id]/properties-tab.tsx`

```tsx
import { formatZAR, type getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { archivePropertyAction } from "../actions";
import { PropertyForm } from "./property-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

export function PropertiesTab({
  customer,
  edit,
  add,
}: {
  customer: Customer;
  edit?: string | undefined;
  add: boolean;
}) {
  const editing = customer.properties.find((p) => p.id === edit);
  const locked = Boolean(customer.anonymisedAt);

  if (add) return <PropertyForm customerId={customer.id} />;
  if (editing) return <PropertyForm customerId={customer.id} property={editing} />;

  return (
    <div className="space-y-4">
      {customer.properties.length === 0 ? (
        <p className="text-charcoal/60">No properties yet.</p>
      ) : null}
      <ul className="space-y-4">
        {customer.properties.map((p) => (
          <li key={p.id} className="rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-forest">{p.label}</p>
                <p className="text-sm text-charcoal">
                  {[p.addressLine1, p.addressLine2, p.suburb, p.city, p.postalCode]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {p.mapUrl ? (
                  <a
                    href={p.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-forest underline"
                  >
                    Open map
                  </a>
                ) : null}
              </div>
              {locked ? null : (
                <div className="flex gap-2">
                  <Link
                    href={`/customers/${customer.id}?tab=properties&edit=${p.id}`}
                    className={secondaryButtonClass}
                  >
                    Edit
                  </Link>
                  <form action={archivePropertyAction}>
                    <input type="hidden" name="customerId" value={customer.id} />
                    <input type="hidden" name="propertyId" value={p.id} />
                    <button type="submit" className={secondaryButtonClass}>
                      Archive
                    </button>
                  </form>
                </div>
              )}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-charcoal/60">Service: </dt>
                <dd className="inline">
                  {p.frequency ? p.frequency.toLowerCase().replace("_", "-") : "not set"}
                  {p.preferredDay ? `, ${p.preferredDay}` : ""}
                </dd>
              </div>
              <div>
                <dt className="inline text-charcoal/60">Monthly fee: </dt>
                <dd className="inline">
                  {p.agreedMonthlyFeeCents === null
                    ? "not set"
                    : formatZAR(p.agreedMonthlyFeeCents)}
                </dd>
              </div>
              <div>
                <dt className="inline text-charcoal/60">Lawn: </dt>
                <dd className="inline">
                  {[
                    p.lawnSizeSqm ? `${p.lawnSizeSqm} m²` : null,
                    p.grassType,
                    p.hasIrrigation ? "irrigation" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="inline text-charcoal/60">Extras: </dt>
                <dd className="inline">{p.extrasNote || "—"}</dd>
              </div>
              {p.accessNotes ? (
                <div className="sm:col-span-2">
                  <dt className="inline text-charcoal/60">Access: </dt>
                  <dd className="inline">{p.accessNotes}</dd>
                </div>
              ) : null}
              {p.terrainNotes ? (
                <div className="sm:col-span-2">
                  <dt className="inline text-charcoal/60">Terrain: </dt>
                  <dd className="inline">{p.terrainNotes}</dd>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
      {locked ? null : (
        <Link
          href={`/customers/${customer.id}?tab=properties&add=1`}
          className={secondaryButtonClass}
        >
          Add property
        </Link>
      )}
    </div>
  );
}
```

In `[id]/page.tsx` render `<PropertiesTab customer={customer} edit={sp.edit} add={sp.add === "1"} />` for `tab === "properties"`.

- [ ] **Step 4: Verify in the browser** — add a property with fee `850` → shows **R850.00**; edit it: the fee box is pre-filled `850.00`; bad map link (`javascript:alert(1)`) is rejected; archive removes it from the tab.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add properties tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Privacy tools in the data layer (export and anonymise)

**Files:**

- Create: `packages/core/src/customers/privacy.ts`, `privacy.db.test.ts`
- Modify: `packages/core/src/customers/index.ts`

**Interfaces:**

- Consumes: `Store`, `Actor`, `assertRole`, `OWNER_ONLY`, `DomainError`, `logCustomerEvent`, `parseCustomerNumber`, `createCustomer`.
- Produces: `exportCustomerData(store, actor, id) => { exportedAt: string; customer: ...; activity: ... }` (OWNER only, audited), `anonymiseCustomer(store, actor, id, confirmNumber: string)` (OWNER only, audited, irreversible).

- [ ] **Step 1: Write the failing tests** — `privacy.db.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { DomainError, ForbiddenError, type Actor } from "./access";
import { createCustomer, getCustomer, updateCustomer } from "./customers";
import { anonymiseCustomer, exportCustomerData } from "./privacy";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const owner: Actor = { id: randomUUID(), role: "OWNER" };
const manager: Actor = { id: randomUUID(), role: "MANAGER" };

const make = (tx: Parameters<typeof createCustomer>[0]) =>
  createCustomer(tx, owner, {
    customer: customerSchema.parse({
      type: "PERSON",
      displayName: "Private Person",
      notes: "private note",
      billingLine1: "9 Secret Lane",
    }),
    contact: contactSchema.parse({
      name: "Private Contact",
      email: "private@example.com",
      phone: "0821234567",
    }),
    property: propertySchema.parse({
      label: "Home",
      addressLine1: "9 Secret Lane",
      accessNotes: "code 9999",
      monthlyFee: "500",
    }),
  });

describe.skipIf(!dbTestsEnabled)("customer privacy tools", () => {
  it("exports everything for the owner and audits it", async () => {
    await withRollback(async (tx) => {
      const { id } = await make(tx);
      const data = await exportCustomerData(tx, owner, id);
      expect(data.customer?.displayName).toBe("Private Person");
      expect(data.customer?.contacts[0]?.email).toBe("private@example.com");
      expect(
        (await tx.auditLog.findMany({ where: { entityId: id, action: "customer.exported" } }))
          .length,
      ).toBe(1);
    });
  });

  it("refuses managers", async () => {
    await withRollback(async (tx) => {
      const { id, number } = await make(tx);
      await expect(exportCustomerData(tx, manager, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(anonymiseCustomer(tx, manager, id, `C-${number}`)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  it("needs the customer number typed correctly", async () => {
    await withRollback(async (tx) => {
      const { id } = await make(tx);
      await expect(anonymiseCustomer(tx, owner, id, "C-9999999")).rejects.toBeInstanceOf(
        DomainError,
      );
    });
  });

  it("removes personal details everywhere, keeps the row, and locks editing", async () => {
    await withRollback(async (tx) => {
      const { id, number } = await make(tx);
      await anonymiseCustomer(tx, owner, id, `C-${String(number).padStart(4, "0")}`);

      const after = await tx.customer.findUnique({
        where: { id },
        include: { contacts: true, properties: true },
      });
      const text = JSON.stringify(after);
      for (const secret of [
        "Private",
        "private@example.com",
        "+27821234567",
        "Secret Lane",
        "9999",
        "private note",
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(after?.anonymisedAt).not.toBeNull();
      expect(after?.status).toBe("ARCHIVED");
      expect(after?.properties[0]?.agreedMonthlyFeeCents).toBe(50000); // money history is kept

      await expect(
        updateCustomer(
          tx,
          owner,
          id,
          customerSchema.parse({ type: "PERSON", displayName: "Back again" }),
        ),
      ).rejects.toBeInstanceOf(DomainError);

      const audit = JSON.stringify(await tx.auditLog.findMany({ where: { entityId: id } }));
      expect(audit).not.toContain("Private");
      expect(audit).toContain("customer.anonymised");
      expect(await getCustomer(tx, owner, id)).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test:db`.

- [ ] **Step 3: Implement** — `privacy.ts`

```ts
import { assertRole, DomainError, OWNER_ONLY, type Actor } from "./access";
import { parseCustomerNumber } from "./number";
import { logCustomerEvent, type Store } from "./store";

/** Everything held about one customer (POPIA "what do you hold about me"). Owner only. */
export async function exportCustomerData(store: Store, actor: Actor, id: string) {
  assertRole(actor, OWNER_ONLY);
  const customer = await store.customer.findUnique({
    where: { id },
    include: { contacts: true, properties: true },
  });
  if (!customer) throw new DomainError("That customer could not be found.");
  const activity = await store.auditLog.findMany({
    where: { entityType: "customer", entityId: id },
    orderBy: { at: "asc" },
    select: { at: true, action: true, actorType: true },
  });
  await logCustomerEvent(store, actor, "customer.exported", id);
  return { exportedAt: new Date().toISOString(), customer, activity };
}

/**
 * Permanently removes a customer's personal details but keeps the record, its number and any
 * money amounts, so old invoices still add up. Owner only, cannot be undone.
 */
export async function anonymiseCustomer(
  store: Store,
  actor: Actor,
  id: string,
  confirmNumber: string,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const customer = await store.customer.findUnique({ where: { id } });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) throw new DomainError("This customer is already anonymised.");
  if (parseCustomerNumber(confirmNumber) !== customer.number) {
    throw new DomainError("Type the customer number exactly as shown to confirm.");
  }

  const now = new Date();
  await store.customer.update({
    where: { id },
    data: {
      displayName: "Anonymised customer",
      companyName: null,
      registrationNumber: null,
      billingLine1: null,
      billingLine2: null,
      billingSuburb: null,
      billingCity: null,
      billingPostalCode: null,
      sourceNote: null,
      notes: null,
      consentAt: null,
      consentSource: null,
      consentNote: null,
      status: "ARCHIVED",
      statusBeforeArchive: null,
      archivedAt: customer.archivedAt ?? now,
      anonymisedAt: now,
    },
  });
  await store.contact.updateMany({
    where: { customerId: id },
    data: { name: "Anonymised contact", role: null, email: null, phone: null, portalAccess: false },
  });
  await store.property.updateMany({
    where: { customerId: id },
    data: {
      label: "Anonymised property",
      addressLine1: "Anonymised",
      addressLine2: null,
      suburb: null,
      city: null,
      postalCode: null,
      mapUrl: null,
      accessNotes: null,
      terrainNotes: null,
      extrasNote: null,
    },
  });
  await logCustomerEvent(store, actor, "customer.anonymised", id);
}
```

Add `export * from "./privacy";` to `customers/index.ts`.

- [ ] **Step 4: Run, then commit**

```bash
npm run test:db && npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add customer export and anonymise (owner only)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all database tests PASS.

---

### Task 11: Activity tab and owner tools in the app

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/[id]/activity-tab.tsx`, `[id]/owner-tools.tsx`, `[id]/export/route.ts`
- Modify: `[id]/page.tsx`, `[id]/overview-tab.tsx`, `customers/actions.ts`

**Interfaces:**

- Consumes: `listCustomerActivity`, `exportCustomerData`, `anonymiseCustomer`, `formatCustomerNumber`.
- Produces: `anonymiseCustomerAction(prev, formData)`; `GET /customers/[id]/export` (JSON download, owner only).

- [ ] **Step 1: Anonymise action** (append; add `anonymiseCustomer` to the core import and `import { OWNER_ONLY... }` not needed, use the literal)

```ts
export async function anonymiseCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: "Something went wrong. Refresh the page and try again." };
  try {
    await inTx((tx) => anonymiseCustomer(tx, actor, id.data, values.confirm ?? ""));
  } catch (error) {
    return failure(error);
  }
  redirect(`/customers/${id.data}`);
}
```

- [ ] **Step 2: Export route** — `[id]/export/route.ts`

```ts
import { exportCustomerData, formatCustomerNumber, inTx } from "@ace/core";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);

  const data = await inTx((tx) => exportCustomerData(tx, actor, id));
  const name = data.customer ? formatCustomerNumber(data.customer.number) : "customer";
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 3: Owner tools and activity tab**

`[id]/owner-tools.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { FormMessage, secondaryButtonClass } from "@/components/form";
import { inputClass } from "@/components/auth-card";
import { anonymiseCustomerAction } from "../actions";

export function OwnerTools({ id, number }: { id: string; number: string }) {
  const [state, action, pending] = useActionState(anonymiseCustomerAction, undefined);
  return (
    <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/50 p-5">
      <h2 className="font-display text-lg font-semibold text-red-900">Owner tools</h2>
      <p className="text-sm text-charcoal/80">
        <a href={`/customers/${id}/export`} className="font-semibold text-forest underline">
          Download all data we hold
        </a>{" "}
        about this customer (JSON file).
      </p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-charcoal/80">
          <strong>Anonymise</strong> permanently removes names, phone numbers, emails, addresses,
          notes and access details. The customer number and money amounts stay so old invoices still
          add up. <strong>This cannot be undone.</strong>
        </p>
        <label className="block text-sm font-medium">
          Type {number} to confirm
          <input name="confirm" autoComplete="off" className={inputClass} />
        </label>
        <FormMessage error={state?.error} />
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Working…" : "Anonymise this customer"}
        </button>
      </form>
    </section>
  );
}
```

`[id]/activity-tab.tsx`:

```tsx
import type { listCustomerActivity } from "@ace/core";

type Entries = Awaited<ReturnType<typeof listCustomerActivity>>;

const label: Record<string, string> = {
  "customer.created": "Customer created",
  "customer.updated": "Details changed",
  "customer.archived": "Archived",
  "customer.restored": "Restored",
  "customer.contact_added": "Contact added",
  "customer.contact_updated": "Contact changed",
  "customer.contact_removed": "Contact removed",
  "customer.property_added": "Property added",
  "customer.property_updated": "Property changed",
  "customer.property_archived": "Property archived",
  "customer.exported": "Data exported",
  "customer.anonymised": "Anonymised",
};

export function ActivityTab({ entries }: { entries: Entries }) {
  if (entries.length === 0) return <p className="text-charcoal/60">No activity yet.</p>;
  return (
    <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
      {entries.map((e) => {
        const changed = (e.after as { changed?: string[] } | null)?.changed;
        return (
          <li key={e.id} className="px-4 py-3 text-sm">
            <p className="font-semibold text-forest">{label[e.action] ?? e.action}</p>
            <p className="text-charcoal/60">
              {e.actorName} · {e.at.toLocaleString("en-ZA")}
              {changed?.length ? ` · fields: ${changed.join(", ")}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Wire them in**

In `[id]/page.tsx`: import `listCustomerActivity`, `ActivityTab`; for `tab === "activity"` do `<ActivityTab entries={await listCustomerActivity(getDb(), actor, id)} />` (the page is an async server component, so `await` inline is fine; if the linter complains, compute `const entries = tab === "activity" ? await listCustomerActivity(...) : []` above the return). In `overview-tab.tsx` replace the temporary "Owner tools are added in a later step." line with `{isOwner && !c.anonymisedAt ? <OwnerTools id={c.id} number={formatCustomerNumber(c.number)} /> : null}` (import `formatCustomerNumber` from `@ace/core` and `OwnerTools`).

- [ ] **Step 5: Verify in the browser** (made-up customer only)

Activity tab shows created/changed/archived lines with the staff name and **field names only**. As owner: **Download all data** returns a JSON file; typing the wrong number shows an error; typing `C-000X` for a throwaway customer anonymises it: name becomes "Anonymised customer", contacts and properties are blanked, edit/archive buttons disappear, and its Activity shows "Anonymised".

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add activity tab and owner export and anonymise tools" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: CSV import logic (parse, map, classify, commit)

**Files:**

- Modify: `packages/core/package.json` (papaparse)
- Create: `packages/core/src/customers/csv.ts`, `csv.test.ts`, `import.ts`, `import.db.test.ts`
- Modify: `packages/core/src/customers/index.ts`

**Interfaces:**

- Consumes: Task 2 schemas and `normalisePhone`; Task 3 `Store`, `Actor`, `assertRole`, mappers; `recordAudit`.
- Produces:
  - `IMPORT_COLUMNS`, `IMPORT_TEMPLATE: string`, `MAX_IMPORT_ROWS = 2000`, `MAX_IMPORT_BYTES = 2 * 1024 * 1024`
  - `type RawImportRow = Record<string, string>`
  - `parseCsvText(text: string): { rows: RawImportRow[] } | { error: string }`
  - `mapImportRow(raw: RawImportRow, line: number): { ok: true; row: MappedRow } | { ok: false; line: number; errors: string[] }`
  - `type ImportPreview = { create: MappedRow[]; duplicates: { line: number; displayName: string; reason: string }[]; errors: { line: number; errors: string[] }[] }`
  - `prepareImport(store, actor, rows: RawImportRow[]): Promise<ImportPreview>`
  - `commitImport(store, actor, rows): Promise<{ created: number; duplicates: number; errors: number }>`

- [ ] **Step 1: Install the CSV library**

```bash
cd "C:/Users/compl/Desktop/Lloyd/Claude/ACE Website/ace-erp"
npm install papaparse -w @ace/core
npm install -D @types/papaparse -w @ace/core
```

- [ ] **Step 2: Write the failing tests** — `csv.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  IMPORT_TEMPLATE,
  MAX_IMPORT_ROWS,
  mapImportRow,
  parseCsvText,
  type RawImportRow,
} from "./csv";

const row = (over: Partial<RawImportRow> = {}): RawImportRow => ({
  type: "",
  display_name: "Test Person",
  company_name: "",
  contact_name: "",
  email: "test@example.com",
  phone: "",
  billing_line1: "",
  billing_suburb: "",
  billing_city: "",
  billing_postal_code: "",
  property_address: "",
  property_suburb: "",
  property_city: "",
  frequency: "",
  monthly_fee_rand: "",
  extras: "",
  source: "",
  notes: "",
  ...over,
});

describe("parseCsvText", () => {
  it("reads the template we hand out", () => {
    const result = parseCsvText(IMPORT_TEMPLATE);
    expect("rows" in result && result.rows.length).toBe(1);
  });
  it("handles a byte-order mark, quotes and semicolons", () => {
    const csv = '\uFEFFDisplay_Name;Email\n"Smith, J";j@example.com\n';
    const result = parseCsvText(csv);
    expect("rows" in result && result.rows[0]?.display_name).toBe("Smith, J");
    expect("rows" in result && result.rows[0]?.email).toBe("j@example.com");
  });
  it("needs a display_name column and at least one row", () => {
    expect("error" in parseCsvText("email\nx@example.com\n")).toBe(true);
    expect("error" in parseCsvText("display_name\n")).toBe(true);
  });
  it("refuses too many rows", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Person ${i}`).join("\n");
    expect("error" in parseCsvText(`display_name\n${body}`)).toBe(true);
  });
});

describe("mapImportRow", () => {
  it("maps a good row, defaulting the contact name to the customer name", () => {
    const r = mapImportRow(
      row({
        phone: "082 123 4567",
        property_address: "1 Test St",
        frequency: "Fortnightly",
        monthly_fee_rand: "R 850",
        type: "company",
      }),
      2,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.customer.type).toBe("COMPANY");
      expect(r.row.contact.name).toBe("Test Person");
      expect(r.row.contact.phone).toBe("+27821234567");
      expect(r.row.property?.frequency).toBe("FORTNIGHTLY");
      expect(r.row.property?.monthlyFee).toBe(85000);
    }
  });
  it("reports every problem with the line number", () => {
    const r = mapImportRow(
      row({ display_name: "", email: "nope", phone: "12", frequency: "daily", type: "alien" }),
      7,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(7);
      expect(r.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
  it("needs an email or a phone", () => {
    const r = mapImportRow(row({ email: "", phone: "" }), 3);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run and confirm failure** — `cd packages/core && npx vitest run src/customers/csv.test.ts`.

- [ ] **Step 4: Implement `csv.ts`**

```ts
import Papa from "papaparse";
import {
  contactSchema,
  customerSchema,
  propertySchema,
  type ContactInput,
  type CustomerInput,
  type PropertyInput,
} from "./schemas";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const IMPORT_COLUMNS = [
  "type",
  "display_name",
  "company_name",
  "contact_name",
  "email",
  "phone",
  "billing_line1",
  "billing_suburb",
  "billing_city",
  "billing_postal_code",
  "property_address",
  "property_suburb",
  "property_city",
  "frequency",
  "monthly_fee_rand",
  "extras",
  "source",
  "notes",
] as const;

/** Handed out as a download. The example row is made up. */
export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(",")}\nperson,Sample Customer,,Sample Contact,sample@example.com,082 123 4567,1 Example Road,Exampleville,Boksburg,1459,1 Example Road,Exampleville,Boksburg,weekly,850,weed treatment,referral,Imported sample\n`;

export type RawImportRow = Record<string, string>;

export function parseCsvText(text: string): { rows: RawImportRow[] } | { error: string } {
  const parsed = Papa.parse<Record<string, string | undefined>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.some((e) => e.type === "Quotes")) {
    return {
      error:
        "The file has a broken quote mark. Open it in a spreadsheet, save it again as CSV and retry.",
    };
  }
  if (!(parsed.meta.fields ?? []).includes("display_name")) {
    return {
      error: 'The file needs a "display_name" column. Download the template to see the layout.',
    };
  }
  if (parsed.data.length === 0) return { error: "The file has no rows." };
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return {
      error: `The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
    };
  }
  const rows = parsed.data.map((r) => {
    const out: RawImportRow = {};
    for (const column of IMPORT_COLUMNS) out[column] = (r[column] ?? "").trim();
    return out;
  });
  return { rows };
}

export type MappedRow = {
  line: number;
  customer: CustomerInput;
  contact: ContactInput;
  property?: PropertyInput | undefined;
};

const TYPES: Record<string, "PERSON" | "COMPANY"> = {
  "": "PERSON",
  person: "PERSON",
  individual: "PERSON",
  homeowner: "PERSON",
  company: "COMPANY",
  business: "COMPANY",
  "body corporate": "COMPANY",
  agent: "COMPANY",
};
const FREQUENCIES: Record<string, string> = {
  weekly: "WEEKLY",
  fortnightly: "FORTNIGHTLY",
  "every 2 weeks": "FORTNIGHTLY",
  monthly: "MONTHLY",
  "once-off": "ONCE_OFF",
  "once off": "ONCE_OFF",
  once: "ONCE_OFF",
};
const SOURCES: Record<string, string> = {
  referral: "REFERRAL",
  google: "GOOGLE",
  facebook: "FACEBOOK",
  directory: "DIRECTORY",
  other: "OTHER",
};

function issues(
  prefix: string,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): string[] {
  return error.issues.map((i) => `${prefix}${i.path.join(".") || "value"}: ${i.message}`);
}

/** One spreadsheet row -> validated records, or a list of everything wrong with it. */
export function mapImportRow(
  raw: RawImportRow,
  line: number,
): { ok: true; row: MappedRow } | { ok: false; line: number; errors: string[] } {
  const errors: string[] = [];
  const get = (key: string) => raw[key] ?? "";

  const type = TYPES[get("type").toLowerCase()];
  if (!type) errors.push(`type: "${get("type")}" is not person or company.`);

  const freqText = get("frequency").toLowerCase();
  const frequency = FREQUENCIES[freqText];
  if (freqText && !frequency)
    errors.push(
      `frequency: "${get("frequency")}" is not weekly, fortnightly, monthly or once-off.`,
    );

  const sourceText = get("source").toLowerCase();
  const source = SOURCES[sourceText];
  if (sourceText && !source)
    errors.push(
      `source: "${get("source")}" is not referral, google, facebook, directory or other.`,
    );

  const customer = customerSchema.safeParse({
    type: type ?? "PERSON",
    displayName: get("display_name"),
    companyName: get("company_name"),
    status: "ACTIVE",
    billingLine1: get("billing_line1"),
    billingSuburb: get("billing_suburb"),
    billingCity: get("billing_city"),
    billingPostalCode: get("billing_postal_code"),
    source: source ?? "",
    notes: get("notes"),
  });
  const contact = contactSchema.safeParse({
    name: get("contact_name") || get("display_name"),
    email: get("email"),
    phone: get("phone"),
    receivesQuotes: "on",
    receivesInvoices: "on",
  });
  const wantsProperty = get("property_address") !== "";
  const property = wantsProperty
    ? propertySchema.safeParse({
        label: "Main property",
        addressLine1: get("property_address"),
        suburb: get("property_suburb"),
        city: get("property_city"),
        frequency: frequency ?? "",
        monthlyFee: get("monthly_fee_rand"),
        extrasNote: get("extras"),
      })
    : null;

  if (!customer.success) errors.push(...issues("", customer.error));
  if (!contact.success) errors.push(...issues("contact ", contact.error));
  if (property && !property.success) errors.push(...issues("property ", property.error));
  if (
    errors.length > 0 ||
    !customer.success ||
    !contact.success ||
    (property && !property.success)
  ) {
    return { ok: false, line, errors };
  }
  return {
    ok: true,
    row: {
      line,
      customer: customer.data,
      contact: contact.data,
      property: property?.success ? property.data : undefined,
    },
  };
}
```

- [ ] **Step 5: Run `csv.test.ts`** — expected PASS.

- [ ] **Step 6: Write the failing database tests** — `import.db.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { ForbiddenError, type Actor } from "./access";
import type { RawImportRow } from "./csv";
import { createCustomer } from "./customers";
import { commitImport, prepareImport } from "./import";
import { contactSchema, customerSchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };

const row = (over: Partial<RawImportRow>): RawImportRow => ({
  type: "",
  display_name: "Import Person",
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  billing_line1: "",
  billing_suburb: "",
  billing_city: "",
  billing_postal_code: "",
  property_address: "",
  property_suburb: "",
  property_city: "",
  frequency: "",
  monthly_fee_rand: "",
  extras: "",
  source: "",
  notes: "",
  ...over,
});

describe.skipIf(!dbTestsEnabled)("customer import", () => {
  it("sorts rows into create, duplicate and error", async () => {
    await withRollback(async (tx) => {
      await createCustomer(tx, manager, {
        customer: customerSchema.parse({ type: "PERSON", displayName: "Existing One" }),
        contact: contactSchema.parse({ name: "E", email: "existing@example.com" }),
      });
      const preview = await prepareImport(tx, manager, [
        row({ display_name: "New A", email: "newa@example.com" }),
        row({ display_name: "Dup By Email", email: "existing@example.com" }),
        row({ display_name: "Dup In File", email: "newa@example.com" }),
        row({ display_name: "Bad", email: "not-an-email" }),
        row({
          display_name: "New B",
          phone: "082 555 0101",
          property_address: "5 Import St",
          monthly_fee_rand: "400",
        }),
      ]);
      expect(preview.create.map((r) => r.customer.displayName)).toEqual(["New A", "New B"]);
      expect(preview.duplicates.map((d) => d.line)).toEqual([3, 4]);
      expect(preview.errors.map((e) => e.line)).toEqual([5]);
    });
  });

  it("commits only the good rows, in one go, and audits counts only", async () => {
    await withRollback(async (tx) => {
      const result = await commitImport(tx, manager, [
        row({
          display_name: "Commit A",
          email: "commita@example.com",
          property_address: "1 Commit Rd",
          monthly_fee_rand: "850",
        }),
        row({ display_name: "Commit B", phone: "0825550102" }),
        row({ display_name: "Broken", email: "x" }),
      ]);
      expect(result).toEqual({ created: 2, duplicates: 0, errors: 1 });
      const made = await tx.customer.findMany({
        where: { displayName: { startsWith: "Commit " } },
        include: { contacts: true, properties: true },
        orderBy: { displayName: "asc" },
      });
      expect(made).toHaveLength(2);
      expect(made[0]?.properties[0]?.agreedMonthlyFeeCents).toBe(85000);
      expect(made[1]?.contacts[0]?.phone).toBe("+27825550102");

      const audit = await tx.auditLog.findFirst({ where: { action: "customer.imported" } });
      expect(audit?.after).toEqual({ created: 2, duplicates: 0, errors: 1 });
      expect(JSON.stringify(audit)).not.toContain("Commit A");
    });
  });

  it("refuses crew", async () => {
    await withRollback(async (tx) => {
      await expect(
        prepareImport(tx, { id: randomUUID(), role: "CREW" }, [row({})]),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
```

- [ ] **Step 7: Run and confirm failure**, then implement `import.ts`:

```ts
import { randomUUID } from "node:crypto";
import { recordAudit } from "../audit";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { MAX_IMPORT_ROWS, mapImportRow, type MappedRow, type RawImportRow } from "./csv";
import { contactData, customerData, propertyData } from "./mappers";
import type { Store } from "./store";

export type ImportPreview = {
  create: MappedRow[];
  duplicates: { line: number; displayName: string; reason: string }[];
  errors: { line: number; errors: string[] }[];
};

const key = (name: string, address: string) =>
  `${name.trim().toLowerCase()}|${address.trim().toLowerCase()}`;

/**
 * Sorts spreadsheet rows into: will be created, looks like a duplicate (skipped) and has errors
 * (skipped). Changes nothing. Also used by `commitImport`, so what you preview is what you get.
 */
export async function prepareImport(
  store: Store,
  actor: Actor,
  raw: RawImportRow[],
): Promise<ImportPreview> {
  assertRole(actor, MANAGEMENT);
  if (raw.length > MAX_IMPORT_ROWS)
    throw new DomainError(`Imports are limited to ${MAX_IMPORT_ROWS} rows.`);

  const contacts = await store.contact.findMany({
    where: { customer: { anonymisedAt: null } },
    select: { email: true, phone: true },
  });
  const emails = new Set(contacts.flatMap((c) => (c.email ? [c.email] : [])));
  const phones = new Set(contacts.flatMap((c) => (c.phone ? [c.phone] : [])));

  const customers = await store.customer.findMany({
    where: { anonymisedAt: null },
    select: { displayName: true, properties: { select: { addressLine1: true } } },
  });
  const nameAddress = new Set<string>();
  for (const c of customers) {
    nameAddress.add(key(c.displayName, ""));
    for (const p of c.properties) nameAddress.add(key(c.displayName, p.addressLine1));
  }

  const preview: ImportPreview = { create: [], duplicates: [], errors: [] };
  raw.forEach((rawRow, index) => {
    const line = index + 2; // line 1 is the header
    const mapped = mapImportRow(rawRow, line);
    if (!mapped.ok) {
      preview.errors.push({ line, errors: mapped.errors });
      return;
    }
    const { customer, contact, property } = mapped.row;
    const nameKey = key(customer.displayName, property?.addressLine1 ?? "");
    let reason: string | null = null;
    if (contact.email && emails.has(contact.email)) reason = "email already used";
    else if (contact.phone && phones.has(contact.phone)) reason = "phone already used";
    else if (nameAddress.has(nameKey)) reason = "same name and address";
    if (reason) {
      preview.duplicates.push({ line, displayName: customer.displayName, reason });
      return;
    }
    // Remember it, so the same person twice in one file is caught too.
    if (contact.email) emails.add(contact.email);
    if (contact.phone) phones.add(contact.phone);
    nameAddress.add(nameKey);
    preview.create.push(mapped.row);
  });
  return preview;
}

/** Creates the good rows in three bulk inserts. Call inside `inTx` so it is all-or-nothing. */
export async function commitImport(store: Store, actor: Actor, raw: RawImportRow[]) {
  const preview = await prepareImport(store, actor, raw);
  const ids = preview.create.map(() => randomUUID());

  if (preview.create.length > 0) {
    await store.customer.createMany({
      data: preview.create.map((r, i) => ({
        id: ids[i]!,
        ...customerData(r.customer),
        consentAt: null,
        createdById: actor.id,
      })),
    });
    await store.contact.createMany({
      data: preview.create.map((r, i) => ({ customerId: ids[i]!, ...contactData(r.contact) })),
    });
    const withProperty = preview.create.flatMap((r, i) =>
      r.property ? [{ customerId: ids[i]!, ...propertyData(r.property) }] : [],
    );
    if (withProperty.length > 0) await store.property.createMany({ data: withProperty });
  }

  const summary = {
    created: preview.create.length,
    duplicates: preview.duplicates.length,
    errors: preview.errors.length,
  };
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action: "customer.imported",
    entityType: "customer_import",
    after: summary, // counts only, no personal details
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
  return summary;
}
```

Add `export * from "./csv"; export * from "./import";` to `customers/index.ts`.

- [ ] **Step 8: Run everything**

```bash
npm run test && npm run test:db && npm run typecheck && npm run lint && npm run format
```

Expected: unit tests and database tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add customer CSV import logic" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Import screens

**Files:**

- Create: `apps/admin/src/app/(staff)/customers/import/page.tsx`, `import/import-form.tsx`, `import/actions.ts`, `import/template/route.ts`

**Interfaces:**

- Consumes: `parseCsvText`, `prepareImport`, `commitImport`, `inTx`, `MAX_IMPORT_BYTES`, `MAX_IMPORT_ROWS`, `IMPORT_TEMPLATE`.
- Produces: `previewImportAction(prev, formData): Promise<ImportState>`, `commitImportAction(prev, formData): Promise<ImportState>`; `GET /customers/import/template`.

- [ ] **Step 1: Actions** — `import/actions.ts`

```ts
"use server";

import {
  commitImport,
  inTx,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsvText,
  prepareImport,
  type ImportPreview,
  type RawImportRow,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure } from "@/lib/form";

export type ImportState =
  | {
      error?: string;
      /** Only what the screen needs to show; the full rows travel in `rowsJson`. */
      preview?: {
        createCount: number;
        sample: { line: number; displayName: string }[];
        duplicates: ImportPreview["duplicates"];
        errors: ImportPreview["errors"];
      };
      /** The uploaded rows, sent back with the confirm button. The file itself is never stored. */
      rowsJson?: string;
    }
  | undefined;

const MANAGEMENT = ["OWNER", "MANAGER"] as const;

export async function previewImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "That file is bigger than 2 MB." };
  if (!file.name.toLowerCase().endsWith(".csv"))
    return { error: "Only .csv files can be imported." };

  const parsed = parseCsvText(await file.text());
  if ("error" in parsed) return { error: parsed.error };

  try {
    const preview = await inTx((tx) => prepareImport(tx, actor, parsed.rows));
    return {
      preview: {
        createCount: preview.create.length,
        sample: preview.create
          .slice(0, 20)
          .map((r) => ({ line: r.line, displayName: r.customer.displayName })),
        duplicates: preview.duplicates.slice(0, 200),
        errors: preview.errors.slice(0, 200),
      },
      rowsJson: JSON.stringify(parsed.rows),
    };
  } catch (error) {
    return failure(error);
  }
}

const rowsSchema = z.array(z.record(z.string(), z.string())).min(1).max(MAX_IMPORT_ROWS);

export async function commitImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);

  let rows: RawImportRow[];
  try {
    rows = rowsSchema.parse(JSON.parse(String(formData.get("rowsJson") ?? "")));
  } catch {
    return { error: "Something went wrong with the upload. Choose the file again." };
  }

  let created: number;
  try {
    // Everything is re-checked here, so a tampered upload cannot skip the rules.
    const result = await inTx((tx) => commitImport(tx, actor, rows), { timeoutMs: 120_000 });
    created = result.created;
  } catch (error) {
    return failure(error);
  }
  redirect(`/customers?imported=${created}`);
}
```

- [ ] **Step 2: Template route** — `import/template/route.ts`

```ts
import { IMPORT_TEMPLATE } from "@ace/core";
import { requireStaff } from "@/lib/auth";

export async function GET() {
  await requireStaff(["OWNER", "MANAGER"]);
  return new Response(IMPORT_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ace-customer-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 3: Page and form**

`import/page.tsx`:

```tsx
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  await requireStaff(["OWNER", "MANAGER"]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Import customers</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        Upload a CSV file (up to 2 MB or 2,000 rows). You will see a preview first and nothing is
        saved until you confirm. The file itself is never stored.{" "}
        <a href="/customers/import/template" className="font-semibold text-forest underline">
          Download the template
        </a>
        .
      </p>
      <ImportForm />
    </div>
  );
}
```

`import/import-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { FormMessage, secondaryButtonClass } from "@/components/form";
import { commitImportAction, previewImportAction } from "./actions";

export function ImportForm() {
  const [previewState, previewAction, previewing] = useActionState(previewImportAction, undefined);
  const [commitState, commitAction, committing] = useActionState(commitImportAction, undefined);
  const preview = previewState?.preview;

  return (
    <div className="mt-6 space-y-8">
      <form action={previewAction} className="space-y-4">
        <label className="block text-sm font-medium text-charcoal">
          CSV file
          <input type="file" name="file" accept=".csv,text/csv" required className={inputClass} />
        </label>
        <FormMessage error={previewState?.error} />
        <button type="submit" disabled={previewing} className={secondaryButtonClass}>
          {previewing ? "Checking…" : "Preview"}
        </button>
      </form>

      {preview ? (
        <section
          className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10"
          aria-live="polite"
        >
          <h2 className="font-display text-lg font-semibold text-forest">Preview</h2>
          <p className="text-sm">
            <strong>{preview.createCount}</strong> will be added ·{" "}
            <strong>{preview.duplicates.length}</strong> skipped as duplicates ·{" "}
            <strong>{preview.errors.length}</strong> have errors and are skipped
          </p>

          {preview.sample.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">First customers to be added</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
                {preview.sample.map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.displayName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.duplicates.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-ochre">Skipped as duplicates</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
                {preview.duplicates.map((d) => (
                  <li key={d.line}>
                    Line {d.line}: {d.displayName} ({d.reason})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.errors.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-red-800">
                Errors (fix in the file to include these)
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
                {preview.errors.map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.errors.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.createCount > 0 ? (
            <form action={commitAction} className="space-y-3">
              <input type="hidden" name="rowsJson" value={previewState?.rowsJson ?? ""} />
              <FormMessage error={commitState?.error} />
              <button type="submit" disabled={committing} className={buttonClass}>
                {committing ? "Importing…" : `Add ${preview.createCount} customers`}
              </button>
            </form>
          ) : (
            <p className="text-sm text-charcoal/60">Nothing to add from this file.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser** (made-up CSV only; create it in a scratch folder, not in the project)

Create a small CSV with 5 made-up rows: two good, one duplicate of an existing customer's email, one with `email = nope`, one repeating the first row's email. Upload: preview shows 2 / 2 duplicates / 1 error with the line numbers. **Add 2 customers** → `/customers?imported=2` shows the green notice and both customers appear. Re-uploading the same file now reports all as duplicates. A `.txt` file and an empty file give clear errors. Download the template and confirm it opens as a clean one-row CSV.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "Add customer CSV import screens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Crew access check, documentation, full check and hand-over

**Files:**

- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-11-18-customers-design.md`

- [ ] **Step 1: Crew test in the browser** (throwaway account, deleted afterwards)

Create a throwaway CREW staff account. If the session scratch tool `e2e-tools.mjs` exists (`create`, `totp`, `cleanup`), use it; otherwise ask the owner to run `npm run staff:create` once with role CREW and a made-up email such as `ace.crew.test@example.com`. Sign in in a private window and confirm all of:

1. `/customers` shows the list with the search box but **no** Add/Import buttons and no status filter; search by address works.
2. Opening a customer shows only name, number, property addresses, map link and access notes. **No** fees, emails, phones, billing, notes, tabs or edit buttons.
3. Typing `/customers/new`, `/customers/import` and `/customers/import/template` in the address bar sends the crew user to **/forbidden**.
4. `/customers/<id>/export` sends them to **/forbidden**.
5. An archived or lead customer's URL returns "not found" for crew.

Then remove the throwaway account (scratch tool `cleanup`, or deactivate and delete it in the Supabase dashboard).

- [ ] **Step 2: Owner and manager walk-through** (made-up data; delete or anonymise afterwards)

Add, search by number/name/phone/address, edit, add a second contact and property, archive and restore, import a CSV, view Activity (field names only), export JSON, anonymise a throwaway customer. Check the audit trail in the database has no personal values: `node "<scratchpad>/e2e-tools.mjs" audit` (or query `audit_log`) should show `customer.*` actions with only ids, counts and field names.

- [ ] **Step 3: Update the docs**

In `README.md` add to "Everyday commands": `npm run test:db` (runs the database tests against the development database; each test is rolled back). Add a short "Customers" paragraph pointing at the spec.

In `docs/ARCHITECTURE.md` add a section after "Staff sign-in (Module 0b)":

```markdown
## Customers (Module 1)

- Customer, Contact and Property tables; customers are archived, never deleted. Numbers (C-0001)
  come from a database sequence and are never reused.
- Role rules live in `packages/core/src/customers/`, not in the screens. OWNER and MANAGER see
  everything; CREW only get the fixed column list in `views.ts` (no fees, emails, phones, billing
  or notes). Only OWNER can export or anonymise a customer.
- The audit log records field NAMES and ids for customer changes, never the values, so anonymising
  a customer leaves no personal data behind in the append-only log.
- CSV import: preview first, duplicates and errors skipped, file never stored, counts-only audit.
- `npm run test:db` runs database tests inside rolled-back transactions against the dev database.
```

In the spec, under "Decisions to confirm at review", add: `4. Audit entries hold field names and ids only, never personal values (so anonymising works).` and in "Testing" add that database tests run through `npm run test:db` and are skipped in CI.

- [ ] **Step 4: Full check, then ask before pushing**

```bash
npm run check && npm run test:db && npm run build
git status --short   # no .env files, no csv files, no AGENTS.md
git add -A
git commit -m "Document the customers module" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: everything passes. Then tell the owner what was built and ask for permission to push (`git push origin HEAD`). Do not push without the owner's yes.

---

## Self-Review

**Spec coverage**

| Spec requirement                                                                                                              | Task                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Customer / Contact / Property data, statuses, consent fields, archive and anonymise columns                                   | 1                                                                                      |
| Customer number from a sequence, never reused                                                                                 | 1, 2, 3                                                                                |
| RLS, revoked privileges, constraints                                                                                          | 1 (plus protection test)                                                               |
| Role matrix incl. crew view enforced in the data layer, tests prove it                                                        | 2 (column list), 3 (DB tests), 14 (browser)                                            |
| `/customers` list, search (number, name, email, phone, address), status filter, 25/page, archived hidden                      | 3, 5                                                                                   |
| `/customers/new` with first contact and optional property, duplicate warning not block                                        | 6                                                                                      |
| Customer page tabs, edit, add contact/property, archive, restore                                                              | 7, 8, 9                                                                                |
| Activity tab (audit trail)                                                                                                    | 3 (`listCustomerActivity`), 11                                                         |
| Owner-only export and anonymise with typed confirmation, audited                                                              | 10, 11                                                                                 |
| Server-side validation, SA phone normalisation                                                                                | 2                                                                                      |
| CSV import: template, limits, preview, duplicates skipped, errors listed, one transaction, file not stored, counts-only audit | 12, 13                                                                                 |
| Fee and extras as plain fields, `formatZAR` display                                                                           | 1, 9                                                                                   |
| Tests: unit, DB checks, browser tests incl. crew, CI                                                                          | 2, 3, 4, 10, 12, 14                                                                    |
| Mobile-first add form                                                                                                         | 5, 6 (single-column layout, responsive grids; checked at phone width in Task 5 Step 6) |

Deliberate refinement of the spec: audit lines hold field names and ids rather than values (needed so anonymising is real). Task 14 records this in the spec.

**Known limits to flag to the owner at hand-over**

- Database tests run only locally against the dev database (`npm run test:db`); CI skips them because it has no database.
- Rolled-back tests can leave gaps in the dev database's customer numbers. Harmless; live numbering starts clean in the live project.
- Crew browser test needs a throwaway crew account (Task 14 explains how).

**Type consistency check:** `Actor`, `Store`, `inTx`, `ContactInput`/`PropertyInput`/`CustomerInput`, `monthlyFee` (cents after parsing) and `agreedMonthlyFeeCents` (column) are used consistently across Tasks 2-13; `FormState`, `failure`, `formValues`, `withPrefix`, `errorsFrom` are defined in Task 5 and reused unchanged; action names (`createCustomerAction`, `updateCustomerAction`, `archiveCustomerAction`, `restoreCustomerAction`, `saveContactAction`, `removeContactAction`, `savePropertyAction`, `archivePropertyAction`, `anonymiseCustomerAction`, `previewImportAction`, `commitImportAction`) match where they are imported.
