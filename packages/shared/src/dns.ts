import { type Address, isAddressEqual } from "viem";

/**
 * Issuer identity cross-check through DNS (queried over DNS-over-HTTPS).
 *
 * An accredited organization proves that it controls the address registered
 * on-chain by publishing a TXT record on the domain it declared:
 *
 *     _sitepass.apave.com.  TXT  "sitepass-issuer=0xIssuerAddress"
 *
 * The registry says "the admin accredited this address as Apave"; DNS says
 * "whoever runs apave.com claims this address". Both channels must be
 * compromised to impersonate an issuer.
 */
export const DNS_RECORD_PREFIX = "_sitepass";
export const DNS_TXT_KEY = "sitepass-issuer";

export const DOH_RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

export type DnsCheckResult =
  | { status: "VERIFIED"; recordName: string; records: string[] }
  | { status: "MISMATCH"; recordName: string; records: string[]; claimedAddresses: string[] }
  | { status: "NOT_FOUND"; recordName: string }
  | { status: "ERROR"; recordName: string; message: string };

export function dnsRecordName(domain: string): string {
  return `${DNS_RECORD_PREFIX}.${domain.trim().toLowerCase().replace(/\.$/, "")}`;
}

export function expectedDnsTxtValue(address: Address): string {
  return `${DNS_TXT_KEY}=${address}`;
}

interface DohAnswer {
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

async function queryTxt(resolver: string, name: string, signal?: AbortSignal): Promise<string[]> {
  const url = `${resolver}?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetch(url, { headers: { accept: "application/dns-json" }, signal });
  if (!response.ok) throw new Error(`DoH resolver answered HTTP ${response.status}`);
  const body = (await response.json()) as DohResponse;
  // Status 3 = NXDOMAIN.
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DNS error code ${body.Status}`);
  return (body.Answer ?? [])
    .filter((answer) => answer.type === 16)
    .map((answer) =>
      // TXT data comes quoted and may be split in several 255-byte strings.
      answer.data
        .split(/"\s*"/)
        .join("")
        .replace(/^"|"$/g, ""),
    );
}

export async function checkIssuerDns(
  domain: string,
  issuer: Address,
  options: { signal?: AbortSignal } = {},
): Promise<DnsCheckResult> {
  const recordName = dnsRecordName(domain);
  let lastError = "No resolver reachable";

  for (const resolver of DOH_RESOLVERS) {
    try {
      const records = await queryTxt(resolver, recordName, options.signal);
      const claims = records
        .map((record) => record.trim())
        .filter((record) => record.toLowerCase().startsWith(`${DNS_TXT_KEY}=`))
        .map((record) => record.slice(DNS_TXT_KEY.length + 1).trim());

      if (claims.length === 0) return { status: "NOT_FOUND", recordName };
      const matches = claims.some((claim) => /^0x[0-9a-fA-F]{40}$/.test(claim) && isAddressEqual(claim as Address, issuer));
      return matches
        ? { status: "VERIFIED", recordName, records }
        : { status: "MISMATCH", recordName, records, claimedAddresses: claims };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { status: "ERROR", recordName, message: lastError };
}
