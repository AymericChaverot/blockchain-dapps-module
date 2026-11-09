import { checkIssuerDns, dnsRecordName, expectedDnsTxtValue } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheckIcon, GlobeIcon, Loader2Icon, ShieldAlertIcon, ShieldQuestionIcon } from "lucide-react";
import type { Address } from "viem";

import { Badge } from "@/components/ui/badge";

/**
 * Cross-checks the issuer identity through a second, independent channel:
 * the DNS TXT record `_sitepass.<domain>` must contain the issuer address.
 */
export function DnsCheckBadge({ domain, issuer }: { domain: string; issuer: Address }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dns", domain, issuer],
    queryFn: ({ signal }) => checkIssuerDns(domain, issuer, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading || !data) {
    return (
      <Badge variant="muted">
        <Loader2Icon className="animate-spin" /> Checking DNS…
      </Badge>
    );
  }

  const hint = `Expected TXT record on ${dnsRecordName(domain)}: "${expectedDnsTxtValue(issuer)}"`;
  switch (data.status) {
    case "VERIFIED":
      return (
        <Badge variant="success" title={`Found on ${data.recordName}`}>
          <BadgeCheckIcon /> DNS verified
        </Badge>
      );
    case "MISMATCH":
      return (
        <Badge variant="danger" title={`${data.recordName} points to ${data.claimedAddresses.join(", ")}`}>
          <ShieldAlertIcon /> DNS mismatch
        </Badge>
      );
    case "NOT_FOUND":
      return (
        <Badge variant="warning" title={hint}>
          <ShieldQuestionIcon /> No DNS proof
        </Badge>
      );
    default:
      return (
        <Badge variant="muted" title={data.message}>
          <ShieldQuestionIcon /> DNS unreachable
        </Badge>
      );
  }
}

export function IssuerIdentity({
  name,
  domain,
  address,
  active,
}: {
  name: string;
  domain: string;
  address: Address;
  active: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{name || "Unregistered issuer"}</span>
        {active ? <Badge variant="success">Accredited</Badge> : <Badge variant="suspended">Not accredited</Badge>}
      </div>
      {domain && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1">
            <GlobeIcon className="size-3.5" />
            {domain}
          </span>
          <DnsCheckBadge domain={domain} issuer={address} />
        </div>
      )}
    </div>
  );
}
