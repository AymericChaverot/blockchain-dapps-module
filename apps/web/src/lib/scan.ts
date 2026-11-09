import { isAddressLike, isBytes32 } from "@sitepass/shared";
import { type Address, type Hex, getAddress } from "viem";

import { parseSignatureInput } from "@/lib/proofChannel";

/**
 * What a SitePass QR code can carry. Every code is either a link to this app
 * (so that a phone's native camera also opens it) or a raw value.
 */
export type ScannedCode =
  | { kind: "credential"; id: Hex }
  | { kind: "holder"; address: Address }
  | { kind: "challenge"; code: string }
  | { kind: "signature"; signature: Hex }
  | { kind: "unknown"; text: string };

export function parseScannedCode(raw: string): ScannedCode {
  const text = raw.trim();

  const signature = parseSignatureInput(text);
  if (signature) return { kind: "signature", signature };
  if (isBytes32(text)) return { kind: "credential", id: text as Hex };
  if (isAddressLike(text)) return { kind: "holder", address: getAddress(text) };

  try {
    const url = new URL(text);
    const challenge = url.searchParams.get("c");
    if (url.pathname.endsWith("/prove") && challenge) return { kind: "challenge", code: challenge };
    const id = url.searchParams.get("id");
    if (id && isBytes32(id)) return { kind: "credential", id: id as Hex };
    const holder = url.searchParams.get("holder") ?? url.pathname.match(/\/holder\/(0x[0-9a-fA-F]{40})/)?.[1];
    if (holder && isAddressLike(holder)) return { kind: "holder", address: getAddress(holder) };
  } catch {
    // Not a URL.
  }
  return { kind: "unknown", text };
}

/** In-app route for a scanned code, when it has one. */
export function scannedCodePath(code: ScannedCode): string | undefined {
  switch (code.kind) {
    case "credential":
      return `/?id=${code.id}`;
    case "holder":
      return `/holder/${code.address}`;
    case "challenge":
      return `/prove?c=${encodeURIComponent(code.code)}`;
    default:
      return undefined;
  }
}
