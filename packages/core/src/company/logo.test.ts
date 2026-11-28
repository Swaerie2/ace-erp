import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, inspectLogo } from "./logo";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const NOT_AN_IMAGE = "Use a PNG or JPEG picture.";

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The IEND chunk every complete PNG ends with (length 0, type, fixed CRC). */
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/**
 * The signature, an IHDR chunk (CRC not checked by the inspection, so zeros do), any extra chunk bytes,
 * then IEND, so the file ends like a complete PNG.
 */
function pngHeader(width: number, height: number, extra: number[] = []): number[] {
  return [
    ...PNG_SIGNATURE,
    ...u32(13),
    ...ascii("IHDR"),
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
    ...extra,
    ...IEND,
  ];
}

/** A real, fully decodable PNG (one colour), built with zlib. */
function realPng(width: number, height: number): Uint8Array {
  const crc = (bytes: number[]) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: number[]) => {
    const body = [...ascii(type), ...data];
    return [...u32(data.length), ...body, ...u32(crc(body))];
  };
  const row = [0, ...Array.from({ length: width }, () => [31, 77, 54]).flat()];
  const raw = Array.from({ length: height }, () => row).flat();
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [...deflateSync(Uint8Array.from(raw))]),
    ...chunk("IEND", []),
  ]);
}

/** SOI, an APP0 segment to skip, then a SOF marker with the size. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    sof,
    0x00,
    0x11,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

/** A real 40 x 40 baseline JPEG (made once with an image tool; one colour). */
const REAL_JPEG_BASE64 =
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAoACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAIE/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnQEsoAAAAAAAAAAAAAAAD//Z";

describe("inspectLogo", () => {
  it("accepts a PNG and reads its size from the IHDR chunk", () => {
    const bytes = Uint8Array.from(pngHeader(300, 120));
    expect(inspectLogo(bytes)).toEqual({
      ok: true,
      contentType: "image/png",
      width: 300,
      height: 120,
      byteSize: bytes.length,
    });
  });

  it("accepts a real PNG", () => {
    const bytes = realPng(40, 40);
    expect(inspectLogo(bytes)).toMatchObject({ ok: true, contentType: "image/png", width: 40 });
  });

  it("accepts a PNG with an animation chunk as a plain PNG", () => {
    const bytes = Uint8Array.from(pngHeader(64, 64, [...u32(8), ...ascii("acTL"), 0, 0, 0, 2]));
    expect(inspectLogo(bytes)).toMatchObject({ ok: true, contentType: "image/png" });
  });

  it("accepts a JPEG, skipping segments before the size marker (SOF0, SOF1 and SOF2)", () => {
    for (const sof of [0xc0, 0xc1, 0xc2]) {
      const bytes = jpeg(800, 400, sof);
      expect(inspectLogo(bytes)).toEqual({
        ok: true,
        contentType: "image/jpeg",
        width: 800,
        height: 400,
        byteSize: bytes.length,
      });
    }
  });

  it("accepts a real JPEG", () => {
    const bytes = Uint8Array.from(Buffer.from(REAL_JPEG_BASE64, "base64"));
    expect(inspectLogo(bytes)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
      width: 40,
      height: 40,
    });
  });

  it("refuses an empty file and a file over 500 KB", () => {
    expect(inspectLogo(new Uint8Array(0))).toEqual({ ok: false, problem: "The file is empty." });
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG_SIGNATURE);
    expect(MAX_LOGO_BYTES).toBe(524288);
    expect(inspectLogo(big)).toEqual({
      ok: false,
      problem: "Use a picture of 500 KB or less.",
    });
  });

  it("refuses SVG, HTML, GIF, WEBP and PDF by their first bytes", () => {
    const texts = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "<!doctype html><html><body>hello</body></html>",
      "GIF89a\u0001\u0000\u0001\u0000",
      "RIFF\u0000\u0000\u0000\u0000WEBPVP8 ",
      "%PDF-1.7\n",
    ];
    for (const text of texts) {
      expect(inspectLogo(new TextEncoder().encode(text))).toEqual({
        ok: false,
        problem: NOT_AN_IMAGE,
      });
    }
  });

  it("decides by the bytes, not the name: an SVG renamed to .png is still refused", () => {
    // The function never sees a name or a claimed type; only the bytes count.
    const bytes = new TextEncoder().encode("<svg></svg>");
    expect(inspectLogo(bytes)).toEqual({ ok: false, problem: NOT_AN_IMAGE });
  });

  it("refuses a truncated PNG or JPEG without throwing", () => {
    const unreadable = "The picture could not be read. Save it again and try once more.";
    const png = pngHeader(100, 100);
    for (let cut = 1; cut < png.length; cut += 1) {
      const result = inspectLogo(Uint8Array.from(png.slice(0, cut)));
      expect(result.ok, `png cut at ${cut}`).toBe(false);
    }
    expect(inspectLogo(Uint8Array.from(png.slice(0, 20)))).toEqual({
      ok: false,
      problem: unreadable,
    });
    const full = jpeg(100, 100);
    for (let cut = 3; cut < full.length - 2; cut += 1) {
      const result = inspectLogo(full.slice(0, cut));
      expect(result, `jpeg cut at ${cut}`).toEqual({ ok: false, problem: unreadable });
    }
  });

  it("refuses a PNG or JPEG whose header is fine but whose end is missing", () => {
    const damaged = "That picture looks damaged. Save it again and try once more.";
    const png = pngHeader(100, 100);
    expect(inspectLogo(Uint8Array.from(png.slice(0, png.length - 12)))).toEqual({
      ok: false,
      problem: damaged,
    });
    expect(inspectLogo(Uint8Array.from(png.slice(0, png.length - 1)))).toEqual({
      ok: false,
      problem: damaged,
    });
    const real = realPng(40, 40);
    expect(inspectLogo(real.slice(0, real.length - 20))).toEqual({ ok: false, problem: damaged });
    expect(inspectLogo(Uint8Array.from([...real, 0]))).toEqual({ ok: false, problem: damaged });
    const full = jpeg(100, 100);
    expect(inspectLogo(full.slice(0, full.length - 2))).toEqual({ ok: false, problem: damaged });
    expect(inspectLogo(full.slice(0, full.length - 1))).toEqual({ ok: false, problem: damaged });
    expect(inspectLogo(Uint8Array.from([...full, 0x41]))).toEqual({ ok: false, problem: damaged });
  });

  it("accepts a JPEG with zero padding after its end marker", () => {
    expect(inspectLogo(Uint8Array.from([...jpeg(100, 100), 0, 0, 0]))).toMatchObject({ ok: true });
  });

  it("refuses a hostile JPEG (zero-length segment, image data before the size) without looping", () => {
    const unreadable = "The picture could not be read. Save it again and try once more.";
    expect(inspectLogo(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xe0]))).toEqual({
      ok: false,
      problem: unreadable,
    });
    expect(inspectLogo(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toEqual({
      ok: false,
      problem: unreadable,
    });
    expect(inspectLogo(Uint8Array.from([0xff, 0xd8, 0xff, 0x12, 0x34, 0x56, 0x78]))).toEqual({
      ok: false,
      problem: unreadable,
    });
  });

  it("refuses a JPEG kind the PDF cannot draw (lossless)", () => {
    expect(inspectLogo(jpeg(100, 100, 0xc3))).toEqual({
      ok: false,
      problem: "This kind of JPEG cannot be used. Save it again as a standard JPEG.",
    });
  });

  it("refuses a picture smaller than 32 or larger than 4000 pixels either way", () => {
    const sizeProblem = "Use a picture from 32 to 4000 pixels wide and high.";
    for (const [w, h] of [
      [31, 100],
      [100, 31],
      [4001, 100],
      [100, 4001],
      [0, 0],
    ] as const) {
      expect(inspectLogo(Uint8Array.from(pngHeader(w, h)))).toEqual({
        ok: false,
        problem: sizeProblem,
      });
      expect(inspectLogo(jpeg(w, h))).toEqual({ ok: false, problem: sizeProblem });
    }
    expect(inspectLogo(Uint8Array.from(pngHeader(0xffffffff, 100)))).toEqual({
      ok: false,
      problem: sizeProblem,
    });
    expect(inspectLogo(Uint8Array.from(pngHeader(32, 4000)))).toMatchObject({ ok: true });
  });

  it("has no em dash in any problem", () => {
    const problems = [
      inspectLogo(new Uint8Array(0)),
      inspectLogo(new TextEncoder().encode("<svg/>")),
      inspectLogo(Uint8Array.from(pngHeader(1, 1))),
      inspectLogo(Uint8Array.from(PNG_SIGNATURE)),
      inspectLogo(jpeg(100, 100, 0xc3)),
    ];
    expect(JSON.stringify(problems)).not.toContain("—");
  });
});
