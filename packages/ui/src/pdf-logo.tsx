import { Image, StyleSheet } from "@react-pdf/renderer";

/** The company logo's bytes as the PDF library draws them. Same shape as `PdfLogo` in `@ace/core`. */
export type PdfLogo = { data: Uint8Array; format: "png" | "jpg" };

const s = StyleSheet.create({
  // At most 48pt high and 160pt wide, never stretched, at the top left.
  logo: {
    height: 48,
    maxWidth: 160,
    objectFit: "contain",
    alignSelf: "flex-start",
    marginBottom: 8,
  },
});

/** The logo at the top left of a PDF page, or nothing at all when there is no logo. Hook-free. */
export function LogoImage({ logo }: { logo?: PdfLogo | null }) {
  if (!logo) return null;
  // The PDF library wants a Node Buffer; this one shares the bytes rather than copying them.
  const data = Buffer.from(logo.data.buffer, logo.data.byteOffset, logo.data.byteLength);
  // A PDF picture, not an HTML <img>: the PDF library's Image has no alt text.
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image style={s.logo} src={{ data, format: logo.format }} />;
}
