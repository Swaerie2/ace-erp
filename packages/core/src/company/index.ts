// The company profile: logo and address. Functions without a role check (readCompanyLogo,
// readCompanyLogoVersion, loadLogoForPdf) are deliberately NOT exported here: core code imports them
// directly, the staff app uses getLogoForPdf, and the portal uses getLogoForClientPdf from `@ace/core/portal`.
export {
  COMPANY_ADDRESS_FIELDS,
  companyAddressInputFromForm,
  companyAddressSchema,
  type CompanyAddressInput,
} from "./address";
export { BLANK_COMPANY_ADDRESS, formatCompanyAddress, type CompanyAddressParts } from "./format";
export {
  MAX_LOGO_BYTES,
  MAX_LOGO_PIXELS,
  MIN_LOGO_PIXELS,
  inspectLogo,
  type LogoContentType,
  type LogoInspection,
} from "./logo";
export {
  getCompanyLogoMeta,
  getCompanyProfile,
  getLogoForPdf,
  removeCompanyLogo,
  setCompanyLogo,
  updateCompanyAddress,
  type CompanyLogoMeta,
  type CompanyProfile,
  type CompanyStore,
  type PdfLogo,
} from "./profile";
