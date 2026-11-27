// The company logo check. Pure: no database, no file names. The type is decided from the file's own first
// bytes only, so a renamed or mislabelled file (an SVG called logo.png, an HTML page) is refused.

/** 500 KB, the same limit as the database check on company_logo. */
export const MAX_LOGO_BYTES = 524288;
export const MIN_LOGO_PIXELS = 32;
export const MAX_LOGO_PIXELS = 4000;

export type LogoContentType = "image/png" | "image/jpeg";

export type LogoInspection =
  | { ok: true; contentType: LogoContentType; width: number; height: number; byteSize: number }
  | { ok: false; problem: string };

const PROBLEMS = {
  empty: "The file is empty.",
  tooBig: "Use a picture of 500 KB or less.",
  wrongType: "Use a PNG or JPEG picture.",
  unreadable: "The picture could not be read. Save it again and try once more.",
  damaged: "That picture looks damaged. Save it again and try once more.",
  jpegKind: "This kind of JPEG cannot be used. Save it again as a standard JPEG.",
  size: `Use a picture from ${MIN_LOGO_PIXELS} to ${MAX_LOGO_PIXELS} pixels wide and high.`,
} as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Signature (8), IHDR length and type (8), IHDR data (13) and its CRC (4). */
const PNG_HEADER_BYTES = 33;

/** The IEND chunk every complete PNG ends with: length 0, the type, and its fixed CRC. */
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;

/** A complete PNG ends with IEND as its very last 12 bytes. */
const pngEndsWell = (b: Uint8Array) =>
  b.length >= PNG_IEND.length && PNG_IEND.every((x, i) => b[b.length - PNG_IEND.length + i] === x);

/** A complete JPEG ends with the end-of-image marker FF D9; only zero padding may follow it. */
function jpegEndsWell(b: Uint8Array): boolean {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end -= 1;
  return end >= 2 && b[end - 2] === 0xff && b[end - 1] === 0xd9;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/** Big-endian reads; the caller has checked the bounds. */
const u16 = (b: Uint8Array, i: number) => (b[i] ?? 0) * 0x100 + (b[i + 1] ?? 0);
const u32 = (b: Uint8Array, i: number) => u16(b, i) * 0x10000 + u16(b, i + 2);

type Size = { width: number; height: number };

function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < PNG_HEADER_BYTES) return null;
  const isIhdr = [0x49, 0x48, 0x44, 0x52].every((b, i) => bytes[12 + i] === b);
  if (u32(bytes, 8) !== 13 || !isIhdr) return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

/** Markers with no length after them: TEM, RST0 to RST7. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
/** Baseline, extended and progressive DCT: what the PDF can draw. */
const DRAWABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);
/** The other frame markers (lossless, hierarchical, arithmetic). C4, C8 and CC are not frames. */
const OTHER_SOF = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Walks the JPEG segments up to the frame header. Every read is bounds-checked and every step moves
 * forward by at least two bytes, so a truncated or hostile file ends the walk instead of looping or throwing.
 */
function jpegSize(bytes: Uint8Array): Size | "kind" | null {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes: any number of 0xFF before the marker.
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) return null;
    const marker = bytes[i] ?? 0;
    i += 1;
    if (standalone(marker)) continue;
    // End of image, start of scan or a second start of image before any frame header: no size.
    if (marker === 0xd9 || marker === 0xda || marker === 0xd8) return null;
    if (i + 2 > bytes.length) return null;
    const length = u16(bytes, i);
    if (length < 2 || i + length > bytes.length) return null;
    if (DRAWABLE_SOF.has(marker)) {
      // length (2), precision (1), height (2), width (2), then the components.
      if (length < 8) return null;
      return { width: u16(bytes, i + 5), height: u16(bytes, i + 3) };
    }
    if (OTHER_SOF.has(marker)) return "kind";
    i += length;
  }
  return null;
}

/** Checks an uploaded logo: PNG or JPEG by its first bytes, at most 500 KB, a sensible pixel size. */
export function inspectLogo(bytes: Uint8Array): LogoInspection {
  if (bytes.length === 0) return { ok: false, problem: PROBLEMS.empty };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, problem: PROBLEMS.tooBig };

  let contentType: LogoContentType;
  let size: Size | "kind" | null;
  let endsWell: boolean;
  if (startsWith(bytes, PNG_SIGNATURE)) {
    contentType = "image/png";
    size = pngSize(bytes);
    endsWell = pngEndsWell(bytes);
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    contentType = "image/jpeg";
    size = jpegSize(bytes);
    endsWell = jpegEndsWell(bytes);
  } else {
    return { ok: false, problem: PROBLEMS.wrongType };
  }
  if (size === "kind") return { ok: false, problem: PROBLEMS.jpegKind };
  if (size === null) return { ok: false, problem: PROBLEMS.unreadable };
  // The header can be fine while the rest is cut off (an interrupted download or copy).
  if (!endsWell) return { ok: false, problem: PROBLEMS.damaged };
  const fits = (n: number) => n >= MIN_LOGO_PIXELS && n <= MAX_LOGO_PIXELS;
  if (!fits(size.width) || !fits(size.height)) return { ok: false, problem: PROBLEMS.size };
  return { ok: true, contentType, width: size.width, height: size.height, byteSize: bytes.length };
}
