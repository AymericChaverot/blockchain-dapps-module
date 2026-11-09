import { dnsRecordName, expectedDnsTxtValue } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  BuildingIcon,
  CircleCheckIcon,
  CrownIcon,
  FileCode2Icon,
  Loader2Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldOffIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { type Address, getAddress, isAddress, isAddressEqual } from "viem";
import { useAccount } from "wagmi";

import { ErrorAlert } from "@/components/ErrorAlert";
import { CopyButton, HexValue } from "@/components/HexValue";
import { DnsCheckBadge } from "@/components/IssuerIdentity";
import { EmptyState, PageHeader, StatTile } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { issuerRegistryAbi } from "@/config/abis";
import { explorerAddressUrl, isConfigured, requireContracts } from "@/config/network";
import { useContractAction } from "@/hooks/useContractAction";
import { fetchRegistryOverview } from "@/lib/credentials";
import { formatDate } from "@/lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";

function useRegistry() {
  return useQuery({ queryKey: ["registry"], queryFn: fetchRegistryOverview, enabled: isConfigured });
}

type RegistryData = Awaited<ReturnType<typeof fetchRegistryOverview>>;

function AddIssuerForm() {
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const { run, pending, lastError } = useContractAction();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const outcome = await run(
      {
        address: requireContracts().issuerRegistry,
        abi: issuerRegistryAbi,
        functionName: "addIssuer",
        args: [getAddress(account.trim()), name.trim(), domain.trim().toLowerCase()],
      },
      { pending: "Registering issuer…", success: `${name} is now an accredited issuer` },
    );
    if (outcome) {
      setAccount("");
      setName("");
      setDomain("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issuer-address">Issuer wallet</Label>
        <Input
          id="issuer-address"
          className="font-mono"
          placeholder="0x…"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issuer-name">Public name</Label>
        <Input id="issuer-name" placeholder="Issuer A" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issuer-domain">Reference domain</Label>
        <Input
          id="issuer-domain"
          placeholder="issuer-a.example"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending || !isAddress(account.trim())}>
        {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Accredit
      </Button>
      <div className="sm:col-span-4">
        <ErrorAlert error={lastError} />
      </div>
    </form>
  );
}

function SuspendToggle({ account, active }: { account: Address; active: boolean }) {
  const { run, pending, lastError } = useContractAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        className={active ? "text-suspended hover:text-suspended" : undefined}
        onClick={() =>
          run(
            {
              address: requireContracts().issuerRegistry,
              abi: issuerRegistryAbi,
              functionName: active ? "suspendIssuer" : "reinstateIssuer",
              args: [account],
            },
            { pending: active ? "Suspending…" : "Reinstating…", success: active ? "Issuer suspended" : "Issuer reinstated" },
          )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : active ? <PauseCircleIcon /> : <PlayCircleIcon />}
        {active ? "Suspend" : "Reinstate"}
      </Button>
      {lastError && <span className="text-destructive max-w-56 text-right text-xs">{lastError.description}</span>}
    </div>
  );
}

function IssuersTable({ data, admin }: { data: RegistryData; admin: boolean }) {
  if (data.issuers.length === 0) {
    return (
      <EmptyState icon={<BuildingIcon />} title="No accredited organization yet">
        The registry administrators have not accredited any training organization.
      </EmptyState>
    );
  }
  return (
    <Card className="py-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
            <tr>
              <th className="px-4 py-2.5 font-medium">Organization</th>
              <th className="px-4 py-2.5 font-medium">Wallet</th>
              <th className="px-4 py-2.5 font-medium">Domain proof</th>
              <th className="px-4 py-2.5 font-medium">Accredited since</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              {admin && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.issuers.map((issuer) => (
              <tr key={issuer.account} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
                      {issuer.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-medium">{issuer.name}</div>
                      <div className="text-muted-foreground text-xs">{issuer.domain}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <HexValue value={issuer.account} href={explorerAddressUrl(issuer.account)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <DnsCheckBadge domain={issuer.domain} issuer={issuer.account} />
                    {admin && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                        TXT {dnsRecordName(issuer.domain)}
                        <CopyButton value={expectedDnsTxtValue(issuer.account)} label="record" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="tabular px-4 py-3 whitespace-nowrap">{formatDate(issuer.registeredAt)}</td>
                <td className="px-4 py-3">
                  {issuer.active ? (
                    <Badge variant="success">
                      <CircleCheckIcon /> Active
                    </Badge>
                  ) : (
                    <Badge variant="suspended">
                      <ShieldOffIcon /> Suspended
                    </Badge>
                  )}
                </td>
                {admin && (
                  <td className="px-4 py-3 text-right">
                    <SuspendToggle account={issuer.account} active={issuer.active} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GovernanceCard({ data, isAdmin }: { data: RegistryData; isAdmin: boolean }) {
  const registry = requireContracts().issuerRegistry;
  return (
    <Card className="py-4">
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <CrownIcon className="size-3.5" /> Registry admin (root of trust)
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <HexValue value={data.owner} href={explorerAddressUrl(data.owner)} />
            {isAdmin && <Badge variant="info">You</Badge>}
          </span>
          {data.pendingOwner !== ZERO && (
            <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
              Pending transfer to <HexValue value={data.pendingOwner} href={explorerAddressUrl(data.pendingOwner)} />
              (must call <code>acceptOwnership()</code>)
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <FileCode2Icon className="size-3.5" /> IssuerRegistry contract
          </span>
          <HexValue value={registry} href={explorerAddressUrl(registry)} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Public directory of accredited training organizations. */
export function IssuersPage() {
  const { data, isLoading } = useRegistry();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Verification"
        title="Accredited issuers"
        description="The public whitelist of training organizations allowed to issue SitePass clearances. Anyone can audit it; only the registry administrators can change it."
      />
      {isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}
      {data && (
        <>
          <IssuersTable data={data} admin={false} />
          <GovernanceCard data={data} isAdmin={false} />
        </>
      )}
    </div>
  );
}

/** Registry administration: accredit, suspend, reinstate. */
export function AdminPage() {
  const { address } = useAccount();
  const { data, isLoading } = useRegistry();
  const isAdmin = !!address && !!data && isAddressEqual(address, data.owner);
  const active = data?.issuers.filter((issuer) => issuer.active).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Governance"
        title="Registry administration"
        description="Accredit training organizations and suspend them if they are compromised. Suspension is fail-closed: their credentials immediately show as invalid to verifiers."
      />

      <Alert variant="info">
        <ShieldAlertIcon />
        <AlertTitle>The registry admin is the root of trust</AlertTitle>
        <AlertDescription>
          <p>
            Whoever controls this account decides who may issue clearances. In production it must be a multisig (e.g. a
            Safe shared by the site operator, the safety authority and an auditor), never a single key. Ownership
            transfers are two-step and renouncing is disabled. The issuer's DNS record is a second, independent check.
          </p>
        </AlertDescription>
      </Alert>

      {isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Organizations" value={data.issuers.length} icon={<BuildingIcon />} />
            <StatTile label="Active" value={active} icon={<CircleCheckIcon />} tone="success" />
            <StatTile label="Suspended" value={data.issuers.length - active} icon={<ShieldOffIcon />} tone="suspended" />
          </div>

          <GovernanceCard data={data} isAdmin={isAdmin} />

          <Card>
            <CardHeader>
              <CardTitle>Accredit a training organization</CardTitle>
              <CardDescription>
                The organization should publish <code>_sitepass.&lt;domain&gt;</code> TXT{" "}
                <code>sitepass-issuer=&lt;wallet&gt;</code> so that verifiers can cross-check its identity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddIssuerForm />
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Organizations</h2>
            <IssuersTable data={data} admin />
          </section>
        </>
      )}
    </div>
  );
}
