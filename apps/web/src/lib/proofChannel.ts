import type { Address, Hex } from "viem";

/**
 * Same-browser convenience for the demo: when the holder signs in another tab,
 * the signature is pushed to the verifier tab automatically. Across devices
 * the signature is copied / scanned instead.
 */
const CHANNEL_NAME = "sitepass-proof";

export interface ProofMessage {
  nonce: Hex;
  signature: Hex;
  signer: Address;
}

export function publishProof(message: ProofMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(message);
  channel.close();
}

export function subscribeToProofs(onMessage: (message: ProofMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<ProofMessage>) => onMessage(event.data);
  return () => channel.close();
}

/** Accepts either a raw 0x signature or a full "signature response" JSON. */
export function parseSignatureInput(value: string): Hex | undefined {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{130,}$/.test(trimmed)) return trimmed as Hex;
  try {
    const parsed = JSON.parse(trimmed) as { signature?: string };
    if (parsed.signature && /^0x[0-9a-fA-F]{130,}$/.test(parsed.signature)) return parsed.signature as Hex;
  } catch {
    // not JSON
  }
  return undefined;
}
