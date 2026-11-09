import {
  type Address,
  type Hex,
  bytesToHex,
  encodeAbiParameters,
  hexToString,
  keccak256,
  stringToHex,
  trim,
} from "viem";

/** SHA-256 of raw bytes using WebCrypto (available in browsers and Node >= 20). */
export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<Hex> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return bytesToHex(new Uint8Array(digest));
}

/** Cryptographically random 32-byte value, hex encoded. */
export function randomBytes32(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Encodes a short ASCII clearance code (<= 31 chars) as a right-padded bytes32. */
export function encodeCredentialType(code: string): Hex {
  if (code.length === 0 || code.length > 31 || !/^[\x20-\x7e]+$/.test(code)) {
    throw new Error(`Invalid credential type code "${code}" (1-31 printable ASCII characters).`);
  }
  return stringToHex(code, { size: 32 });
}

/** Decodes a bytes32 clearance code back to its ASCII form. */
export function decodeCredentialType(value: Hex): string {
  if (/^0x0*$/.test(value)) return "";
  return hexToString(trim(value, { dir: "right" }));
}

/**
 * Off-chain mirror of `SiteCredentialManager.computeCredentialId`:
 * keccak256(abi.encode(chainId, manager, issuer, documentHash)).
 */
export function computeCredentialId(params: {
  chainId: number;
  manager: Address;
  issuer: Address;
  documentHash: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(params.chainId), params.manager, params.issuer, params.documentHash],
    ),
  );
}

export function isBytes32(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isAddressLike(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
