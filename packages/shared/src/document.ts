import type { Address, Hex } from "viem";

import { findClearanceType } from "./catalog.ts";
import { randomBytes32, sha256Hex } from "./crypto.ts";

/**
 * Off-chain certificate format: `sitepass.credential.v1`.
 *
 * Loosely aligned on the W3C Verifiable Credentials Data Model 2.0 (`@context`,
 * `type`, `issuer`, `validFrom`, `validUntil`, `credentialSubject`), using
 * `did:pkh` identifiers for the issuer and holder addresses.
 *
 * This JSON contains personal data and NEVER goes on-chain. Only its SHA-256
 * fingerprint (`documentHash`) is anchored. The random `salt` makes the hash
 * impossible to brute-force from guessable fields (name, birth date...).
 *
 * Hashing rule: the fingerprint is the SHA-256 of the exact bytes of the file
 * handed to the worker (UTF-8, as produced by {@link serializeCredentialDocument}).
 * Verifiers hash the raw file bytes; any edit, even whitespace, breaks the match.
 */
export const DOCUMENT_SCHEMA_VERSION = "sitepass.credential.v1";

export interface CredentialDocument {
  "@context": string[];
  type: string[];
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION;
  /**
   * Issuing organization: `address` is its Organization contract (its
   * permanent identity), `signer` the member (person) who issued it.
   */
  issuer: {
    id: string;
    address: Address;
    name: string;
    domain: string;
    signer?: Address;
  };
  validFrom: string;
  validUntil?: string;
  credentialSubject: {
    id: string;
    address: Address;
    firstName: string;
    lastName: string;
    birthDate: string;
    employer: string;
    clearance: {
      code: string;
      label: string;
      category: string;
    };
    training: {
      sessionReference: string;
      location: string;
      completedOn: string;
      result: string;
    };
  };
  anchor: {
    chainId: number;
    contract: Address;
  };
  salt: Hex;
}

export interface BuildCredentialDocumentInput {
  chainId: number;
  manager: Address;
  /** `address`: the organization contract; `signer`: the member issuing it. */
  issuer: { address: Address; name: string; domain: string; signer?: Address };
  holder: {
    address: Address;
    firstName: string;
    lastName: string;
    birthDate: string;
    employer: string;
  };
  clearanceCode: string;
  training: {
    sessionReference: string;
    location: string;
    completedOn: string;
    result: string;
  };
  validFrom: Date;
  validUntil?: Date;
  /** Injected for deterministic tests; random by default. */
  salt?: Hex;
}

export function didPkh(chainId: number, address: Address): string {
  return `did:pkh:eip155:${chainId}:${address}`;
}

export function buildCredentialDocument(input: BuildCredentialDocumentInput): CredentialDocument {
  const clearance = findClearanceType(input.clearanceCode);
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "SitePassSafetyCredential"],
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    issuer: {
      id: didPkh(input.chainId, input.issuer.address),
      address: input.issuer.address,
      name: input.issuer.name,
      domain: input.issuer.domain,
      ...(input.issuer.signer ? { signer: input.issuer.signer } : {}),
    },
    validFrom: input.validFrom.toISOString(),
    ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
    credentialSubject: {
      id: didPkh(input.chainId, input.holder.address),
      address: input.holder.address,
      firstName: input.holder.firstName.trim(),
      lastName: input.holder.lastName.trim(),
      birthDate: input.holder.birthDate,
      employer: input.holder.employer.trim(),
      clearance: {
        code: input.clearanceCode,
        label: clearance?.label ?? input.clearanceCode,
        category: clearance?.category ?? "other",
      },
      training: {
        sessionReference: input.training.sessionReference.trim(),
        location: input.training.location.trim(),
        completedOn: input.training.completedOn,
        result: input.training.result.trim(),
      },
    },
    anchor: {
      chainId: input.chainId,
      contract: input.manager,
    },
    salt: input.salt ?? randomBytes32(),
  };
}

/** Canonical serialization used by the issuer (2-space JSON + trailing newline). */
export function serializeCredentialDocument(document: CredentialDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function hashCredentialDocument(document: CredentialDocument): Promise<Hex> {
  return sha256Hex(serializeCredentialDocument(document));
}

/** Suggested file name for the downloaded certificate. */
export function credentialDocumentFileName(document: CredentialDocument): string {
  const subject = document.credentialSubject;
  const slug = `${subject.lastName}-${subject.firstName}-${subject.clearance.code}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toLowerCase();
  return `sitepass-${slug}.json`;
}

/**
 * Best-effort parsing of a dropped file as a SitePass document. Returns
 * undefined for PDFs or any other format (the raw hash is still compared).
 */
export function tryParseCredentialDocument(bytes: Uint8Array): CredentialDocument | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CredentialDocument>;
    if (parsed?.schemaVersion !== DOCUMENT_SCHEMA_VERSION) return undefined;
    if (!parsed.issuer?.address || !parsed.credentialSubject?.address || !parsed.anchor?.contract) return undefined;
    return parsed as CredentialDocument;
  } catch {
    return undefined;
  }
}
