import {
  loadLogoForPdf,
  readCompanyLogoVersion,
  type LogoStore,
  type PdfLogo,
} from "../company/profile";

/**
 * The company logo for a quote PDF made by the portal app. It takes no scope or actor on purpose: the logo
 * is public (it is printed on every document and served at /company-logo), and the portal route that calls
 * this has already checked the signed-in session or the private quote link before it builds the PDF.
 * Reads only the logo columns the portal's database login may select. Null when there is no logo.
 */
export async function getLogoForClientPdf(store: LogoStore): Promise<PdfLogo | null> {
  return loadLogoForPdf(store);
}

/**
 * The logo's cache buster for the portal's `/company-logo?v=` address, or null when there is no logo. No
 * scope or actor, for the same reason as getLogoForClientPdf: the logo is public. Reads only `updatedAt`.
 */
export async function getLogoVersionForClient(store: LogoStore): Promise<string | null> {
  return readCompanyLogoVersion(store);
}
