import { dnsRecordName, expectedDnsTxtValue } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  BuildingIcon,
  CircleCheckIcon,
  FileCode2Icon,
  GavelIcon,
  HourglassIcon,
  LandmarkIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  ShieldOffIcon,
  TimerIcon,
  UndoIcon,
  UsersRoundIcon,
  VoteIcon,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";
import { type Address, getAddress, isAddress, isAddressEqual, parseEventLogs, zeroAddress } from "viem";

import { ErrorAlert } from "@/components/ErrorAlert";
import {
  ApprovalMeter,
  OrgStatusBadge,
  PhaseBadge,
  formatDuration,
  isSame,
  parseAddressList,
  useNow,
} from "@/components/Governance";
import { CopyButton, HexValue } from "@/components/HexValue";
import { DnsCheckBadge } from "@/components/IssuerIdentity";
import { EmptyState, PageHeader, StatTile } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { issuerRegistryAbi, organizationAbi } from "@/config/abis";
import { explorerAddressUrl, isConfigured, requireContracts } from "@/config/network";
import { useContractAction } from "@/hooks/useContractAction";
import { useRoles } from "@/hooks/useRoles";
import {
  FEDERATION_KIND,
  FEDERATION_KIND_LABEL,
  type Federation,
  type FederationProposal,
  ORG_ACTION,
  ORG_STATUS,
  type OrganizationSummary,
  fetchFederation,
  fetchOrganizationProposals,
  organizationName,
  proposalPhase,
} from "@/lib/governance";
import { formatDate, formatDateTime } from "@/lib/format";

export function useFederation() {
  return useQuery({ queryKey: ["federation"], queryFn: fetchFederation, enabled: isConfigured });
}

// ---------------------------------------------------------------------------
// Public directory
// ---------------------------------------------------------------------------

function OrganizationsTable({ organizations, showDnsRecord }: { organizations: OrganizationSummary[]; showDnsRecord?: boolean }) {
  if (organizations.length === 0) {
    return (
      <EmptyState icon={<BuildingIcon />} title="No organization yet">
        No training organization has been created in the federation.
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
              <th className="px-4 py-2.5 font-medium">Contract (identity)</th>
              <th className="px-4 py-2.5 font-medium">Domain proof</th>
              <th className="px-4 py-2.5 font-medium">People</th>
              <th className="px-4 py-2.5 font-medium">Accredited since</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {organizations.map((org) => (
              <tr key={org.address} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link to={`/organization/${org.address}`} className="flex items-center gap-3">
                    <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
                      {org.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-medium hover:underline">{org.name}</div>
                      <div className="text-muted-foreground text-xs">{org.domain}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <HexValue value={org.address} href={explorerAddressUrl(org.address)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <DnsCheckBadge domain={org.domain} issuer={org.address} />
                    {showDnsRecord && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                        TXT {dnsRecordName(org.domain)}
                        <CopyButton value={expectedDnsTxtValue(org.address)} label="record" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
                  {org.threshold}-of-{org.admins.length} admins
                  <br />
                  {org.members.length} issuing member{org.members.length === 1 ? "" : "s"}
                </td>
                <td className="tabular px-4 py-3 whitespace-nowrap">
                  {org.admittedAt > 0n ? formatDate(org.admittedAt) : "-"}
                </td>
                <td className="px-4 py-3">
                  <OrgStatusBadge status={org.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Public directory of training organizations. */
export function IssuersPage() {
  const { data, isLoading } = useFederation();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Verification"
        title="Accredited organizations"
        description="The public list of training organizations allowed to issue SitePass clearances. Nobody administers it: the organizations admit and suspend each other by vote."
        actions={
          <Button asChild variant="outline">
            <Link to="/governance">
              <LandmarkIcon /> Governance
            </Link>
          </Button>
        }
      />
      {isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}
      {data && <OrganizationsTable organizations={data.organizations} showDnsRecord />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Governance: proposals and votes
// ---------------------------------------------------------------------------

function describeProposal(proposal: FederationProposal, organizations: OrganizationSummary[]): string {
  const target = proposal.target !== zeroAddress ? organizationName(organizations, proposal.target) : "";
  switch (proposal.kind) {
    case FEDERATION_KIND.UPDATE:
      return `${target} → "${proposal.name}" <${proposal.domain}>`;
    case FEDERATION_KIND.SET_QUORUM:
      return `More than ${proposal.quorumBps / 100}% of the eligible organizations`;
    default:
      return target;
  }
}

/**
 * Casting (or withdrawing) the vote of the connected admin's organization.
 * The vote is itself a proposal of the organization's multisig: the first
 * admin opens it, the others approve it, and it runs at the threshold.
 */
function OrgVoteButton({
  proposal,
  organization,
  withdraw,
}: {
  proposal: FederationProposal;
  organization: OrganizationSummary;
  withdraw?: boolean;
}) {
  const { address } = useRoles();
  const { run, pending, lastError } = useContractAction();
  const action = withdraw ? ORG_ACTION.REVOKE_FEDERATION_APPROVAL : ORG_ACTION.APPROVE_FEDERATION_PROPOSAL;
  const { data: internal } = useQuery({
    queryKey: ["org-proposals", organization.address],
    queryFn: () => fetchOrganizationProposals(organization.address),
  });
  const now = Math.floor(Date.now() / 1000);
  const open = internal?.find(
    (item) => item.action === action && item.value === proposal.id && !item.executed && BigInt(now) < item.expiresAt,
  );
  const iApproved = !!open && !!address && open.approvers.some((approver) => isAddressEqual(approver, address));

  if (iApproved && open) {
    return (
      <Badge variant="muted" title="Your co-admins must approve it in the organization page">
        <UsersRoundIcon /> {organization.name}: {Number(open.approvals)}/{organization.threshold} admins
      </Badge>
    );
  }

  const verb = withdraw ? "Withdraw vote" : "Vote";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={withdraw ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          open
            ? run(
                { address: organization.address, abi: organizationAbi, functionName: "approve", args: [open.id] },
                { pending: `Approving the ${organization.name} vote…`, success: "Approval recorded" },
              )
            : run(
                {
                  address: organization.address,
                  abi: organizationAbi,
                  functionName: "propose",
                  args: [action, zeroAddress, proposal.id],
                },
                {
                  pending: `Opening the ${organization.name} vote…`,
                  success:
                    organization.threshold > 1
                      ? `Vote opened in ${organization.name}: ${organization.threshold - 1} more admin approval(s) needed`
                      : `${organization.name} voted`,
                },
              )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : withdraw ? <UndoIcon /> : <VoteIcon />}
        {open ? `Co-sign ${organization.name} ${withdraw ? "withdrawal" : "vote"}` : `${verb} as ${organization.name}`}
      </Button>
      {lastError && <span className="text-destructive max-w-64 text-right text-xs">{lastError.description}</span>}
    </div>
  );
}

function ExecuteButton({ proposal, timelocked }: { proposal: FederationProposal; timelocked: boolean }) {
  const { run, pending, lastError } = useContractAction();
  const starts = timelocked && proposal.readyAt === 0n;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            { address: requireContracts().issuerRegistry, abi: issuerRegistryAbi, functionName: "execute", args: [proposal.id] },
            { pending: "Executing…", success: starts ? "Timelock started" : "Proposal executed" },
          )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : starts ? <TimerIcon /> : <PlayIcon />}
        {starts ? "Start timelock" : "Execute"}
      </Button>
      {lastError && <span className="text-destructive max-w-64 text-right text-xs">{lastError.description}</span>}
    </div>
  );
}

function ProposalCard({ proposal, federation, now }: { proposal: FederationProposal; federation: Federation; now: number }) {
  const roles = useRoles();
  const phase = proposalPhase(proposal, now);
  const myOrg = roles.isOrgAdmin && roles.organizationActive ? roles.organization : undefined;
  const open = phase !== "executed" && phase !== "expired";
  const myOrgApproved = !!myOrg && proposal.approvers.some((org) => isAddressEqual(org, myOrg.address));
  const isOwnSuspension = !!myOrg && proposal.kind === FEDERATION_KIND.SUSPEND && isSame(proposal.target, myOrg.address);
  const passive = proposal.readyAt === 0n && proposal.approvals >= proposal.required;

  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs">#{String(proposal.id)}</span>
              <span className="font-semibold">{FEDERATION_KIND_LABEL[proposal.kind]}</span>
              {!proposal.timelocked && <Badge variant="danger">Emergency · no timelock</Badge>}
            </div>
            <div className="text-sm">{describeProposal(proposal, federation.organizations)}</div>
            <div className="text-muted-foreground text-xs">
              Opened by <HexValue value={proposal.proposer} /> on {formatDateTime(proposal.createdAt)} · expires{" "}
              {formatDateTime(proposal.expiresAt)}
            </div>
          </div>
          <PhaseBadge phase={phase} executableAt={proposal.executableAt} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-col gap-1">
            <ApprovalMeter approvals={Number(proposal.approvals)} required={Number(proposal.required)} />
            <div className="text-muted-foreground flex flex-wrap gap-1 text-xs">
              {proposal.approvers.length === 0
                ? "No organization voted yet"
                : proposal.approvers.map((org) => (
                    <Badge key={org} variant="muted">
                      {organizationName(federation.organizations, org)}
                    </Badge>
                  ))}
            </div>
          </div>
          {open && (
            <div className="flex flex-wrap items-start gap-2">
              {myOrg && !myOrgApproved && !isOwnSuspension && <OrgVoteButton proposal={proposal} organization={myOrg} />}
              {myOrg && myOrgApproved && <OrgVoteButton proposal={proposal} organization={myOrg} withdraw />}
              {isOwnSuspension && <Badge variant="muted">{myOrg?.name} cannot vote on its own suspension</Badge>}
              {roles.isConnected && (phase === "executable" || passive) && (
                <ExecuteButton proposal={proposal} timelocked={proposal.timelocked} />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Governance: forms
// ---------------------------------------------------------------------------

type KindKey = keyof typeof FEDERATION_KIND;

const KIND_TARGET_STATUS: Record<KindKey, number[]> = {
  ADMIT: [ORG_STATUS.PENDING],
  UPDATE: [ORG_STATUS.ACTIVE, ORG_STATUS.SUSPENDED],
  SUSPEND: [ORG_STATUS.ACTIVE],
  REINSTATE: [ORG_STATUS.SUSPENDED],
  SET_QUORUM: [],
};

function NewProposalForm({ federation }: { federation: Federation }) {
  const [kind, setKind] = useState<KindKey>("SUSPEND");
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [quorum, setQuorum] = useState(String(federation.quorumBps / 100));
  const { run, pending, lastError } = useContractAction();

  const candidates = federation.organizations.filter((org) => KIND_TARGET_STATUS[kind].includes(org.status));
  const needsTarget = kind !== "SET_QUORUM";
  const targetAddress = candidates.find((org) => org.address === target)?.address;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const registry = requireContracts().issuerRegistry;
    const labels = { pending: "Opening the proposal…", success: "Proposal opened: organizations can now vote" };
    if (kind === "SET_QUORUM") {
      await run(
        { address: registry, abi: issuerRegistryAbi, functionName: "proposeQuorum", args: [Math.round(Number(quorum) * 100)] },
        labels,
      );
      return;
    }
    if (!targetAddress) return;
    if (kind === "ADMIT") {
      await run({ address: registry, abi: issuerRegistryAbi, functionName: "proposeAdmission", args: [targetAddress] }, labels);
    } else if (kind === "UPDATE") {
      await run(
        {
          address: registry,
          abi: issuerRegistryAbi,
          functionName: "proposeUpdate",
          args: [targetAddress, name.trim(), domain.trim().toLowerCase()],
        },
        labels,
      );
    } else if (kind === "SUSPEND") {
      await run({ address: registry, abi: issuerRegistryAbi, functionName: "proposeSuspension", args: [targetAddress] }, labels);
    } else {
      await run({ address: registry, abi: issuerRegistryAbi, functionName: "proposeReinstatement", args: [targetAddress] }, labels);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kind">Proposal</Label>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as KindKey);
            setTarget("");
          }}
        >
          <SelectTrigger id="kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FEDERATION_KIND) as KindKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                {FEDERATION_KIND_LABEL[FEDERATION_KIND[key]]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {needsTarget ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target">Organization</Label>
          <Select value={targetAddress ?? ""} onValueChange={setTarget}>
            <SelectTrigger id="target" className="w-full">
              <SelectValue placeholder={candidates.length ? "Choose…" : "No eligible organization"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((org) => (
                <SelectItem key={org.address} value={org.address}>
                  {org.name} · {org.domain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quorum">New quorum (% of eligible organizations, strictly more than)</Label>
          <Input
            id="quorum"
            type="number"
            min={50}
            max={100}
            step={0.01}
            value={quorum}
            onChange={(event) => setQuorum(event.target.value)}
          />
        </div>
      )}
      {kind === "UPDATE" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">New public name</Label>
            <Input id="new-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-domain">New reference domain</Label>
            <Input id="new-domain" value={domain} onChange={(event) => setDomain(event.target.value)} required />
          </div>
        </>
      )}
      <div className="flex items-end sm:col-span-2">
        <Button type="submit" disabled={pending || (needsTarget && !targetAddress)}>
          {pending ? <Loader2Icon className="animate-spin" /> : <GavelIcon />} Open the proposal
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorAlert error={lastError} />
      </div>
    </form>
  );
}

function CreateOrganizationForm() {
  const { address } = useRoles();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [admins, setAdmins] = useState("");
  const [threshold, setThreshold] = useState("1");
  const [members, setMembers] = useState("");
  const [created, setCreated] = useState<Address>();
  const { run, pending, lastError } = useContractAction();

  const adminList = parseAddressList(admins);
  const memberList = parseAddressList(members);
  const valid =
    adminList.length > 0 &&
    adminList.every((item) => isAddress(item)) &&
    memberList.every((item) => isAddress(item)) &&
    Number(threshold) >= 1 &&
    Number(threshold) <= adminList.length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const outcome = await run(
      {
        address: requireContracts().issuerRegistry,
        abi: issuerRegistryAbi,
        functionName: "createOrganization",
        args: [
          name.trim(),
          domain.trim().toLowerCase(),
          adminList.map((item) => getAddress(item)),
          BigInt(threshold),
          memberList.map((item) => getAddress(item)),
        ],
      },
      { pending: "Creating the organization…", success: `${name} created: now apply for admission` },
    );
    if (!outcome) return;
    const [log] = parseEventLogs({ abi: issuerRegistryAbi, eventName: "OrganizationCreated", logs: outcome.receipt.logs });
    setCreated(log?.args.org);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-name">Public name</Label>
        <Input id="org-name" placeholder="Issuer C" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-domain">Reference domain</Label>
        <Input
          id="org-domain"
          placeholder="issuer-c.example"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-admins">Admins (one wallet per line)</Label>
        <textarea
          id="org-admins"
          className="border-input bg-background min-h-20 rounded-md border px-3 py-2 font-mono text-xs"
          placeholder={address ?? "0x…"}
          value={admins}
          onChange={(event) => setAdmins(event.target.value)}
        />
        {address && !admins && (
          <button type="button" className="text-primary w-fit text-xs hover:underline" onClick={() => setAdmins(address)}>
            Use my wallet
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-members">Issuing members (one wallet per line, optional)</Label>
        <textarea
          id="org-members"
          className="border-input bg-background min-h-20 rounded-md border px-3 py-2 font-mono text-xs"
          placeholder="0x…"
          value={members}
          onChange={(event) => setMembers(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-threshold">Admin approvals required (threshold)</Label>
        <Input
          id="org-threshold"
          type="number"
          min={1}
          max={Math.max(1, adminList.length)}
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending || !valid}>
          {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Create organization
        </Button>
      </div>
      {created && (
        <Alert variant="info" className="sm:col-span-2">
          <HourglassIcon />
          <AlertTitle>Organization created, pending admission</AlertTitle>
          <AlertDescription>
            <p>
              Its contract <HexValue value={created} /> is its permanent identity: publish{" "}
              <code>_sitepass.{domain || "<domain>"}</code> TXT <code>{expectedDnsTxtValue(created)}</code>. An admin of
              this organization can now open an <b>Admit organization</b> proposal for it below.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <div className="sm:col-span-2">
        <ErrorAlert error={lastError} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Governance page
// ---------------------------------------------------------------------------

/** Federation governance: no admin, organizations vote through their multisigs. */
export function GovernancePage() {
  const roles = useRoles();
  const { data, isLoading } = useFederation();
  const now = useNow();
  const [showClosed, setShowClosed] = useState(false);

  const proposals = useMemo(() => [...(data?.proposals ?? [])].reverse(), [data]);
  const openProposals = proposals.filter((proposal) => {
    const phase = proposalPhase(proposal, now);
    return phase !== "executed" && phase !== "expired";
  });
  const closedProposals = proposals.filter((proposal) => !openProposals.includes(proposal));

  const suspended = data?.organizations.filter((org) => org.status === ORG_STATUS.SUSPENDED).length ?? 0;
  const pending = data?.organizations.filter((org) => org.status === ORG_STATUS.PENDING).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Governance"
        title="Federation governance"
        description="There is no registry admin. Accredited organizations admit, suspend and reinstate each other by vote, each one voting through its own multisig of admins."
      />

      <Alert variant="info">
        <LandmarkIcon />
        <AlertTitle>How a decision is made</AlertTitle>
        <AlertDescription>
          <p>
            An admin of an accredited organization opens a proposal. Each organization votes once its own admins reach
            their internal threshold, so a single stolen key never casts a vote. A proposal passes with strictly more
            than the quorum of the eligible organizations. Admissions, reinstatements, updates and quorum changes then
            wait for a timelock; a suspension runs at once. Unused proposals expire.
          </p>
        </AlertDescription>
      </Alert>

      {isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Voting organizations" value={data.activeCount} icon={<CircleCheckIcon />} tone="success" />
            <StatTile
              label="Suspended · pending"
              value={`${suspended} · ${pending}`}
              icon={<ShieldOffIcon />}
              tone="suspended"
            />
            <StatTile label="Quorum" value={`> ${data.quorumBps / 100}%`} icon={<VoteIcon />} hint="of eligible organizations" />
            <StatTile
              label="Timelock · lifetime"
              value={`${formatDuration(data.timelockDelay)} · ${formatDuration(data.proposalLifetime)}`}
              icon={<TimerIcon />}
            />
          </div>

          <Card className="py-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <FileCode2Icon className="size-3.5" /> IssuerRegistry contract (no owner)
              </span>
              <HexValue value={data.registry} href={explorerAddressUrl(data.registry)} />
              {roles.organization ? (
                <span className="flex items-center gap-2">
                  You: {roles.primaryRole} of <b>{roles.organization.name}</b>
                  <OrgStatusBadge status={roles.organization.status} />
                </span>
              ) : (
                <span className="text-muted-foreground">You do not belong to any accredited organization.</span>
              )}
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Open proposals</h2>
              {closedProposals.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowClosed((value) => !value)}>
                  {showClosed ? "Hide" : "Show"} {closedProposals.length} closed
                </Button>
              )}
            </div>
            {openProposals.length === 0 ? (
              <EmptyState icon={<GavelIcon />} title="No open proposal">
                Admins of accredited organizations can open one below.
              </EmptyState>
            ) : (
              openProposals.map((proposal) => (
                <ProposalCard key={String(proposal.id)} proposal={proposal} federation={data} now={now} />
              ))
            )}
            {showClosed &&
              closedProposals.map((proposal) => (
                <ProposalCard key={String(proposal.id)} proposal={proposal} federation={data} now={now} />
              ))}
          </section>

          {roles.isConnected && (
            <div className="grid items-start gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Open a federation proposal</CardTitle>
                  <CardDescription>
                    Admins of an accredited organization only (the admins of a pending organization may apply for its
                    own admission). The contract rejects anyone else.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <NewProposalForm federation={data} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Create an organization</CardTitle>
                  <CardDescription>
                    Anyone can create one: it starts pending, its people are bound to it once the federation admits it.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CreateOrganizationForm />
                </CardContent>
              </Card>
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Organizations</h2>
            <OrganizationsTable organizations={data.organizations} />
          </section>
        </>
      )}
    </div>
  );
}
