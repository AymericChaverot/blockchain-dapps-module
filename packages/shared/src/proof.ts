import {
  type Address,
  type Hex,
  bytesToHex,
  getAddress,
  hexToBytes,
  isAddressEqual,
  recoverTypedDataAddress,
} from "viem";

import { randomBytes32 } from "./crypto.ts";

/**
 * "Prove my identity" protocol (no transaction, no gas).
 *
 * 1. The verifier generates a fresh {@link ProofChallenge} bound to one
 *    credential, one expected holder, a random nonce and a short lifetime.
 * 2. The holder signs it as EIP-712 typed data with the wallet that received
 *    the credential (`eth_signTypedData_v4`).
 * 3. The verifier recovers the signer and checks it equals the on-chain holder,
 *    that the nonce is the one it issued, and that the challenge is not stale.
 *
 * Binding the signature to the chain id and the manager contract (EIP-712
 * domain) prevents replaying it on another deployment.
 */
export const PROOF_TYPES = {
  ProofOfControl: [
    { name: "nonce", type: "bytes32" },
    { name: "credentialId", type: "bytes32" },
    { name: "holder", type: "address" },
    { name: "site", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export const PROOF_PRIMARY_TYPE = "ProofOfControl";
export const DEFAULT_CHALLENGE_TTL_SECONDS = 5 * 60;

export interface ProofChallenge {
  version: 1;
  chainId: number;
  manager: Address;
  nonce: Hex;
  credentialId: Hex;
  holder: Address;
  site: string;
  issuedAt: number;
  expiresAt: number;
}

export function createProofChallenge(params: {
  chainId: number;
  manager: Address;
  credentialId: Hex;
  holder: Address;
  site: string;
  ttlSeconds?: number;
  now?: number;
}): ProofChallenge {
  const issuedAt = params.now ?? Math.floor(Date.now() / 1000);
  return {
    version: 1,
    chainId: params.chainId,
    manager: params.manager,
    nonce: randomBytes32(),
    credentialId: params.credentialId,
    holder: params.holder,
    site: params.site.trim() || "SitePass checkpoint",
    issuedAt,
    expiresAt: issuedAt + (params.ttlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS),
  };
}

/** Typed data payload passed to `signTypedData` (wagmi / viem). */
export function proofTypedData(challenge: ProofChallenge) {
  return {
    domain: {
      name: "SitePass",
      version: "1",
      chainId: challenge.chainId,
      verifyingContract: challenge.manager,
    },
    types: PROOF_TYPES,
    primaryType: PROOF_PRIMARY_TYPE,
    message: {
      nonce: challenge.nonce,
      credentialId: challenge.credentialId,
      holder: challenge.holder,
      site: challenge.site,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  } as const;
}

export type ProofVerification =
  | { ok: true; signer: Address }
  | { ok: false; reason: "EXPIRED" | "WRONG_SIGNER" | "INVALID_SIGNATURE"; signer?: Address; message: string };

/** Verifies a holder signature against a challenge issued by this verifier. */
export async function verifyProofSignature(
  challenge: ProofChallenge,
  signature: Hex,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ProofVerification> {
  if (now > challenge.expiresAt) {
    return { ok: false, reason: "EXPIRED", message: "The challenge has expired. Generate a new one." };
  }
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...proofTypedData(challenge), signature });
  } catch {
    return { ok: false, reason: "INVALID_SIGNATURE", message: "The signature is malformed." };
  }
  if (!isAddressEqual(signer, challenge.holder)) {
    return {
      ok: false,
      reason: "WRONG_SIGNER",
      signer,
      message: "The signature was produced by a different wallet than the credential holder.",
    };
  }
  return { ok: true, signer };
}

// ---------------------------------------------------------------------------
// Transport helpers: the challenge travels in a URL (link or QR code).
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const COMPACT_PREFIX = "2";

/**
 * Compact form, so that the QR code stays easy to scan on a phone:
 * `2.<base64url(manager ‖ nonce ‖ credentialId ‖ holder)>.<chainId>.<issuedAt>.<ttl>.<site>`
 * (numbers in base 36, site URI-encoded). About 2.5x shorter than the JSON form.
 */
export function encodeChallenge(challenge: ProofChallenge): string {
  const bytes = new Uint8Array(104);
  bytes.set(hexToBytes(challenge.manager), 0);
  bytes.set(hexToBytes(challenge.nonce), 20);
  bytes.set(hexToBytes(challenge.credentialId), 52);
  bytes.set(hexToBytes(challenge.holder), 84);
  return [
    COMPACT_PREFIX,
    bytesToBase64Url(bytes),
    challenge.chainId.toString(36),
    challenge.issuedAt.toString(36),
    (challenge.expiresAt - challenge.issuedAt).toString(36),
    encodeURIComponent(challenge.site),
  ].join(".");
}

function decodeCompact(encoded: string): ProofChallenge | undefined {
  const [prefix, packed, chainId, issuedAt, ttl, ...site] = encoded.split(".");
  if (prefix !== COMPACT_PREFIX || !packed || !chainId || !issuedAt || !ttl) return undefined;
  const bytes = base64UrlToBytes(packed);
  if (bytes.length !== 104) return undefined;
  const issued = Number.parseInt(issuedAt, 36);
  return {
    version: 1,
    chainId: Number.parseInt(chainId, 36),
    manager: getAddress(bytesToHex(bytes.subarray(0, 20))),
    nonce: bytesToHex(bytes.subarray(20, 52)),
    credentialId: bytesToHex(bytes.subarray(52, 84)),
    holder: getAddress(bytesToHex(bytes.subarray(84, 104))),
    site: decodeURIComponent(site.join(".")),
    issuedAt: issued,
    expiresAt: issued + Number.parseInt(ttl, 36),
  };
}

/** Accepts the compact form and the original base64url JSON form. */
export function decodeChallenge(encoded: string): ProofChallenge | undefined {
  try {
    const compact = decodeCompact(encoded);
    if (compact) return compact;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as ProofChallenge;
    if (parsed.version !== 1 || !parsed.nonce || !parsed.credentialId || !parsed.holder) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
