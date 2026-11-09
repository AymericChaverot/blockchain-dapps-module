/**
 * Static catalogs mirrored from the Solidity enums and the clearance types
 * supported by the demo.
 */

export type ClearanceCategory = "nuclear" | "electrical" | "construction" | "hazardous";

export interface ClearanceType {
  /** ASCII code stored on-chain as a right-padded bytes32 (max 31 chars). */
  code: string;
  label: string;
  category: ClearanceCategory;
  description: string;
  /** Default validity proposed by the issuer form, in months (0 = no expiry). */
  defaultValidityMonths: number;
}

export const CLEARANCE_TYPES: readonly ClearanceType[] = [
  {
    code: "NUC-PR1-CC",
    label: "Radiation Protection - Level 1 (PR1-CC)",
    category: "nuclear",
    description: "Work in controlled radiological areas of a nuclear facility.",
    defaultValidityMonths: 36,
  },
  {
    code: "NUC-PR2-CC",
    label: "Radiation Protection - Level 2 (PR2-CC)",
    category: "nuclear",
    description: "Advanced radiation protection, supervision of exposed workers.",
    defaultValidityMonths: 36,
  },
  {
    code: "NUC-CSQ",
    label: "Nuclear Safety & Quality Culture (CSQ)",
    category: "nuclear",
    description: "Safety and quality culture required on nuclear sites.",
    defaultValidityMonths: 36,
  },
  {
    code: "ELEC-H0B0",
    label: "Electrical Clearance H0B0",
    category: "electrical",
    description: "Non-electrical work near electrical installations.",
    defaultValidityMonths: 36,
  },
  {
    code: "ELEC-B2V",
    label: "Electrical Clearance B2V",
    category: "electrical",
    description: "Low-voltage work in the vicinity of live parts, as work leader.",
    defaultValidityMonths: 36,
  },
  {
    code: "ELEC-BR",
    label: "Electrical Clearance BR",
    category: "electrical",
    description: "Low-voltage troubleshooting, connection and maintenance.",
    defaultValidityMonths: 36,
  },
  {
    code: "BTP-WORK-AT-HEIGHT",
    label: "Work at Height & Harness",
    category: "construction",
    description: "Work at height with fall arrest equipment.",
    defaultValidityMonths: 24,
  },
  {
    code: "BTP-CACES-R486",
    label: "CACES R486 - Mobile Elevating Work Platform",
    category: "construction",
    description: "Operation of mobile elevating work platforms (MEWP).",
    defaultValidityMonths: 60,
  },
  {
    code: "HAZ-ATEX-1",
    label: "ATEX Level 1",
    category: "hazardous",
    description: "Work in explosive atmospheres.",
    defaultValidityMonths: 36,
  },
  {
    code: "HAZ-CONFINED-SPACE",
    label: "Confined Space Entry",
    category: "hazardous",
    description: "Entry and work in confined spaces.",
    defaultValidityMonths: 36,
  },
];

export function findClearanceType(code: string): ClearanceType | undefined {
  return CLEARANCE_TYPES.find((type) => type.code === code);
}

/** Mirrors `SiteCredentialManager.RevocationReason` (0 = NONE is not selectable). */
export const REVOCATION_REASONS = {
  1: { key: "SAFETY_BREACH", label: "Safety breach", description: "Serious breach of site safety rules." },
  2: { key: "MEDICAL_UNFIT", label: "Medically unfit", description: "Occupational physician declared the worker unfit." },
  3: { key: "EXPIRED_EARLY", label: "Ended early", description: "Clearance ended before its planned expiry date." },
  4: {
    key: "FRAUDULENT_ISSUANCE",
    label: "Fraudulent issuance",
    description: "Credential was issued by mistake or fraudulently.",
  },
} as const;

export type RevocationReasonCode = keyof typeof REVOCATION_REASONS;

export const REVOCATION_REASON_CODES = Object.keys(REVOCATION_REASONS).map(Number) as RevocationReasonCode[];

export function revocationReasonLabel(code: number): string {
  return REVOCATION_REASONS[code as RevocationReasonCode]?.label ?? "None";
}

/** Mirrors `SiteCredentialManager.CredentialStatus`. */
export const CREDENTIAL_STATUS = {
  UNKNOWN: 0,
  VALID: 1,
  REVOKED: 2,
  EXPIRED: 3,
  ISSUER_SUSPENDED: 4,
} as const;

export type CredentialStatusCode = (typeof CREDENTIAL_STATUS)[keyof typeof CREDENTIAL_STATUS];
