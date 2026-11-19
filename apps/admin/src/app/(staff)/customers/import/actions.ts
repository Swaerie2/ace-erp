"use server";

import {
  commitImport,
  inTx,
  MANAGEMENT,
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
      /** Changes on every response so the form can move focus to the message. */
      nonce?: number;
      /** Only what the screen needs to show; the full rows travel in `rowsJson`. */
      preview?: {
        createCount: number;
        duplicateCount: number;
        errorCount: number;
        sample: { line: number; displayName: string }[];
        duplicates: ImportPreview["duplicates"];
        errors: ImportPreview["errors"];
      };
      /** The name of the file this preview is of (shown so a newly chosen file is not mistaken for it). */
      fileName?: string;
      /** The uploaded rows, sent back with the confirm button. The file itself is never stored. */
      rowsJson?: string;
      /** The spreadsheet row number of each row in `rowsJson`. */
      linesJson?: string;
    }
  | undefined;

const TOO_BIG = "That file is bigger than 2 MB.";
const TOO_BIG_TO_PREVIEW = "This file is too large to preview safely. Split it into smaller files.";
/** The confirm step posts the rows back; a server action body is limited to 3 MB. */
const MAX_ROUNDTRIP_CHARS = 2_400_000;

export async function previewImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);

  // Every limit is checked before the file is read or parsed.
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV file first.", nonce: Date.now() };
  if (file.size === 0) return { error: "That file is empty.", nonce: Date.now() };
  if (file.size > MAX_IMPORT_BYTES) return { error: TOO_BIG, nonce: Date.now() };
  if (!file.name.toLowerCase().endsWith(".csv"))
    return { error: "Only .csv files can be imported.", nonce: Date.now() };

  const parsed = parseCsvText(await file.text());
  if ("error" in parsed) return { error: parsed.error, nonce: Date.now() };

  const rowsJson = JSON.stringify(parsed.rows);
  const linesJson = JSON.stringify(parsed.lines);
  if (rowsJson.length + linesJson.length > MAX_ROUNDTRIP_CHARS)
    return { error: TOO_BIG_TO_PREVIEW, nonce: Date.now() };

  try {
    const preview = await inTx((tx) => prepareImport(tx, actor, parsed.rows, parsed.lines), {
      timeoutMs: 120_000,
    });
    return {
      nonce: Date.now(),
      fileName: file.name.slice(0, 100),
      preview: {
        createCount: preview.create.length,
        duplicateCount: preview.duplicates.length,
        errorCount: preview.errors.length,
        sample: preview.create
          .slice(0, 20)
          .map((r) => ({ line: r.line, displayName: r.customer.displayName })),
        duplicates: preview.duplicates.slice(0, 200),
        errors: preview.errors.slice(0, 200),
      },
      rowsJson,
      linesJson,
    };
  } catch (error) {
    return failure(error);
  }
}

const rowsSchema = z.array(z.record(z.string(), z.string())).min(1).max(MAX_IMPORT_ROWS);
const linesSchema = z.array(z.number().int().positive()).min(1).max(MAX_IMPORT_ROWS);

export async function commitImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);

  let rows: RawImportRow[];
  let lines: number[];
  try {
    rows = rowsSchema.parse(JSON.parse(String(formData.get("rowsJson") ?? "")));
    lines = linesSchema.parse(JSON.parse(String(formData.get("linesJson") ?? "")));
    if (lines.length !== rows.length) throw new Error("length mismatch");
  } catch {
    return {
      error: "Something went wrong with the upload. Choose the file again.",
      nonce: Date.now(),
    };
  }

  let created: number;
  try {
    // Everything is re-checked here, so a tampered upload cannot skip the rules. One
    // transaction, so the import is all or nothing.
    const result = await inTx((tx) => commitImport(tx, actor, rows, lines), {
      timeoutMs: 120_000,
    });
    created = result.created;
  } catch (error) {
    return failure(error);
  }
  redirect(`/customers?imported=${created}`);
}
