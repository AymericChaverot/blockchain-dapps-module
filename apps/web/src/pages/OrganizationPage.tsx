import { useQuery } from "@tanstack/react-query";
import {
  BuildingIcon,
  CheckIcon,
  FileCode2Icon,
  GlobeIcon,
  KeyRoundIcon,
  LandmarkIcon,
  Loader2Icon,
  LogOutIcon,
  PlayIcon,
  SendIcon,
  ShieldCheckIcon,
  TimerIcon,
  UndoIcon,
  UserMinusIcon,
  UsersRoundIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { type Address, getAddress, isAddress, isAddressEqual, zeroAddress } from "viem";

import { ErrorAlert } from "@/components/ErrorAlert";
import {
  ApprovalMeter,
  OrgStatusBadge,
  PersonRow,
  PhaseBadge,
  formatDuration,
  isSame,
  useNow,
} from "@/components/Governance";
import { HexValue } from "@/components/HexValue";
import { DnsCheckBadge } from "@/components/IssuerIdentity";
import { EmptyState, PageHeader, StatTile } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { organizationAbi } from "@/config/abis";
import { explorerAddressUrl, isConfigured } from "@/config/network";
import { useContractAction } from "@/hooks/useContractAction";
import { useRoles } from "@/hooks/useRoles";
import {
  FEDERATION_KIND_LABEL,
  ORG_ACTION,
  ORG_ACTION_LABEL,
  type OrganizationProposal,
  type OrganizationSummary,
  fetchFederation,
  fetchOrganization,
  fetchOrganizationProposals,
  organizationName,
  proposalPhase,
} from "@/lib/governance";
import { formatDateTime } from "@/lib/format";

type ActionKey = "ADD_MEMBER" | "REMOVE_MEMBER" | "ADD_ADMIN" | "REMOVE_ADMIN" | "SET_THRESHOLD";
const PERSON_ACTIONS: ActionKey[] = ["ADD_MEMBER", "REMOVE_MEMBER", "ADD_ADMIN", "REMOVE_ADMIN"];

/** Grants power: waits for the timelock. */
const TIMELOCKED = new Set<number>([ORG_ACTION.ADD_MEMBER, ORG_ACTION.ADD_ADMIN, ORG_ACTION.SET_THRESHOLD]);

function useOrgAction(organization: Address) {
  const action = useContractAction();
  return {
    ...action,
    propose: (kind: number, account: Address, value: bigint, label: string) =>
      action.run(
        { address: organization, abi: organizationAbi, functionName: "propose", args: [kind, account, value] },
        { pending: "Opening the proposal…", success: label },
      ),
  };
}

// ---------------------------------------------------------------------------
// Proposals of the organization's multisig
// ---------------------------------------------------------------------------

function ProposalRow({
  proposal,
  organization,
  isAdmin,
  now,
}: {
  proposal: OrganizationProposal;
  organization: OrganizationSummary;
  isAdmin: boolean;
  now: number;
}) {
  const { address } = useRoles();
  const { run, pending, lastError } = useContractAction();
  const { data: federation } = useQuery({ queryKey: ["federation"], queryFn: fetchFederation, enabled: isConfigured });
  const phase = proposalPhase(proposal, now);
  const open = phase !== "executed" && phase !== "expired";
  const iApproved = !!address && proposal.approvers.some((approver) => isAddressEqual(approver, address));
  const passive = proposal.readyAt === 0n && proposal.approvals >= proposal.required;

  let target: React.ReactNode;
  if (proposal.action === ORG_ACTION.SET_THRESHOLD) {
    target = `${String(proposal.value)}-of-${organization.admins.length} admins`;
  } else if (
    proposal.action === ORG_ACTION.APPROVE_FEDERATION_PROPOSAL ||
    proposal.action === ORG_ACTION.REVOKE_FEDERATION_APPROVAL
  ) {
    const federal = federation?.proposals.find((item) => item.id === proposal.value);
    target = (
      <Link to="/governance" className="hover:underline">
        Federation proposal #{String(proposal.value)}
        {federation &&
          federal &&
          ` · ${FEDERATION_KIND_LABEL[federal.kind]}${federal.target !== zeroAddress ? ` ${organizationName(federation.organizations, federal.target)}` : ""}`}
      </Link>
    );
  } else {
    target = <HexValue value={proposal.account} href={explorerAddressUrl(proposal.account)} />;
  }

  const call = (functionName: "approve" | "revokeApproval" | "execute", success: string) =>
    run({ address: organization.address, abi: organizationAbi, functionName, args: [proposal.id] }, { pending: "Sending…", success });

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">#{String(proposal.id)}</span>
            <span className="font-medium">{ORG_ACTION_LABEL[proposal.action]}</span>
            {!TIMELOCKED.has(proposal.action) && <Badge variant="muted">runs at the threshold</Badge>}
          </div>
          <div className="text-sm">{target}</div>
          <div className="text-muted-foreground text-xs">
            Opened by <HexValue value={proposal.proposer} /> · expires {formatDateTime(proposal.expiresAt)}
          </div>
        </div>
        <PhaseBadge phase={phase} executableAt={proposal.executableAt} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ApprovalMeter approvals={Number(proposal.approvals)} required={Number(proposal.required)} />
        {open && (
          <div className="flex flex-wrap gap-2">
            {isAdmin && !iApproved && (
              <Button size="sm" disabled={pending} onClick={() => call("approve", "Approval recorded")}>
                {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
              </Button>
            )}
            {isAdmin && iApproved && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => call("revokeApproval", "Approval withdrawn")}>
                <UndoIcon /> Withdraw approval
              </Button>
            )}
            {(phase === "executable" || passive) && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => call("execute", "Proposal executed")}>
                {passive && TIMELOCKED.has(proposal.action) ? <TimerIcon /> : <PlayIcon />}
                {passive && TIMELOCKED.has(proposal.action) ? "Start timelock" : "Execute"}
              </Button>
            )}
          </div>
        )}
      </div>
      <ErrorAlert error={lastError} />
    </li>
  );
}

function NewProposalForm({ organization }: { organization: OrganizationSummary }) {
  const [kind, setKind] = useState<ActionKey>("ADD_MEMBER");
  const [account, setAccount] = useState("");
  const [threshold, setThreshold] = useState(String(organization.threshold));
  const { propose, pending, lastError } = useOrgAction(organization.address);
  const needsAccount = PERSON_ACTIONS.includes(kind);
  const valid = needsAccount ? isAddress(account.trim()) : Number(threshold) >= 1;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const outcome = await propose(
      ORG_ACTION[kind],
      needsAccount ? getAddress(account.trim()) : zeroAddress,
      needsAccount ? 0n : BigInt(threshold),
      organization.threshold > 1 ? "Proposal opened: your co-admins must approve it" : "Proposal approved",
    );
    if (outcome) setAccount("");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-action">Change</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as ActionKey)}>
          <SelectTrigger id="org-action" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...PERSON_ACTIONS, "SET_THRESHOLD" as const].map((key) => (
              <SelectItem key={key} value={key}>
                {ORG_ACTION_LABEL[ORG_ACTION[key]]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {needsAccount ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-account">Person (wallet)</Label>
          <Input
            id="org-account"
            className="font-mono"
            placeholder="0x…"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-threshold">New threshold (1 to {organization.admins.length})</Label>
          <Input
            id="org-threshold"
            type="number"
            min={1}
            max={organization.admins.length}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </div>
      )}
      <Button type="submit" disabled={pending || !valid}>
        {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Propose
      </Button>
      <p className="text-muted-foreground text-xs sm:col-span-3">
        {TIMELOCKED.has(ORG_ACTION[kind])
          ? "Grants power: once the threshold is reached, it waits for the timelock before it can be executed."
          : "Removes power: it runs as soon as the threshold is reached (e.g. a lost or stolen key)."}
      </p>
      <div className="sm:col-span-3">
        <ErrorAlert error={lastError} />
      </div>
    </form>
  );
}

function RemoveButton({ organization, account, admin }: { organization: OrganizationSummary; account: Address; admin: boolean }) {
  const { propose, pending, lastError } = useOrgAction(organization.address);
  return (
    <span className="flex flex-col items-end">
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={pending}
        title={admin ? "Propose to remove this admin" : "Propose to remove this issuing member"}
        onClick={() =>
          propose(
            admin ? ORG_ACTION.REMOVE_ADMIN : ORG_ACTION.REMOVE_MEMBER,
            account,
            0n,
            organization.threshold > 1 ? "Removal proposed: your co-admins must approve it" : "Removed",
          )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <UserMinusIcon />}
      </Button>
      {lastError && <span className="text-destructive max-w-56 text-right text-xs">{lastError.description}</span>}
    </span>
  );
}

function LeaveButton({ organization }: { organization: OrganizationSummary }) {
  const { run, pending, lastError } = useContractAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            { address: organization.address, abi: organizationAbi, functionName: "leave", args: [] },
            { pending: "Leaving…", success: `You left ${organization.name}` },
          )
        }
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />} Leave {organization.name}
      </Button>
      {lastError && <span className="text-destructive max-w-64 text-right text-xs">{lastError.description}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function OrganizationView({ address }: { address: Address }) {
  const roles = useRoles();
  const now = useNow();
  const [showClosed, setShowClosed] = useState(false);
  const { data: organization, isLoading } = useQuery({
    queryKey: ["organization", address],
    queryFn: () => fetchOrganization(address),
    enabled: isConfigured,
  });
  const { data: proposals } = useQuery({
    queryKey: ["org-proposals", address],
    queryFn: () => fetchOrganizationProposals(address),
    enabled: isConfigured,
  });
  const { data: federation } = useQuery({ queryKey: ["federation"], queryFn: fetchFederation, enabled: isConfigured });

  if (isLoading) return <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />;
  if (!organization || organization.status === 0) {
    return (
      <EmptyState icon={<BuildingIcon />} title="Unknown organization">
        This address is not an organization of the federation.
      </EmptyState>
    );
  }

  const isAdmin = organization.admins.some((admin) => isSame(admin, roles.address));
  const isMember = organization.members.some((member) => isSame(member, roles.address));
  const list = [...(proposals ?? [])].reverse();
  const open = list.filter((proposal) => {
    const phase = proposalPhase(proposal, now);
    return phase !== "executed" && phase !== "expired";
  });
  const closed = list.filter((proposal) => !open.includes(proposal));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Training organization"
        title={organization.name}
        description="An organization is a contract run by the people behind it: admins decide together (multisig), issuing members sign credentials on its behalf. Its address never changes when people come and go."
        actions={(isAdmin || isMember) && <LeaveButton organization={organization} />}
      />

      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <OrgStatusBadge status={organization.status} />
          <span className="inline-flex items-center gap-1.5">
            <GlobeIcon className="text-muted-foreground size-3.5" /> {organization.domain}
            <DnsCheckBadge domain={organization.domain} issuer={organization.address} />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileCode2Icon className="text-muted-foreground size-3.5" /> Contract
            <HexValue value={organization.address} href={explorerAddressUrl(organization.address)} />
          </span>
          {(isAdmin || isMember) && (
            <Badge variant="info">
              You: {[isAdmin && "admin", isMember && "issuing member"].filter(Boolean).join(" & ")}
            </Badge>
          )}
        </CardContent>
      </Card>

      {organization.status === 1 && (
        <Alert variant="warning">
          <LandmarkIcon />
          <AlertTitle>Pending admission</AlertTitle>
          <AlertDescription>
            <p>
              Its members cannot issue yet. An admin can apply in{" "}
              <Link to="/governance" className="underline">
                Federation governance
              </Link>{" "}
              (<i>Admit organization</i>); the accredited organizations then vote.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {organization.status === 3 && (
        <Alert variant="warning">
          <LandmarkIcon />
          <AlertTitle>Suspended by the federation</AlertTitle>
          <AlertDescription>
            <p>
              Its members cannot issue, its credentials show as "Issuer suspended", and it cannot vote. Members can
              still revoke. Another organization can propose its reinstatement.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Admins" value={organization.admins.length} icon={<KeyRoundIcon />} />
        <StatTile
          label="Threshold"
          value={`${organization.threshold}-of-${organization.admins.length}`}
          icon={<ShieldCheckIcon />}
          hint="admin approvals per decision"
        />
        <StatTile label="Issuing members" value={organization.members.length} icon={<UsersRoundIcon />} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon className="text-primary size-4" /> Admins
            </CardTitle>
            <CardDescription>Govern the organization and cast its vote in the federation.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {organization.admins.map((admin) => (
                <PersonRow key={admin} address={admin} you={isSame(admin, roles.address)}>
                  {isAdmin && <RemoveButton organization={organization} account={admin} admin />}
                </PersonRow>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRoundIcon className="text-primary size-4" /> Issuing members
            </CardTitle>
            <CardDescription>Trainers who issue credentials for the organization and can revoke any of them.</CardDescription>
          </CardHeader>
          <CardContent>
            {organization.members.length === 0 ? (
              <p className="text-muted-foreground text-sm">No issuing member yet.</p>
            ) : (
              <ul className="divide-y">
                {organization.members.map((member) => (
                  <PersonRow key={member} address={member} you={isSame(member, roles.address)}>
                    {isAdmin && <RemoveButton organization={organization} account={member} admin={false} />}
                  </PersonRow>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Propose a change</CardTitle>
            <CardDescription>
              Needs {organization.threshold} admin approval{organization.threshold === 1 ? "" : "s"} (yours included).
              {federation && ` Timelock: ${formatDuration(federation.timelockDelay)}.`} A person can belong to one
              organization only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewProposalForm organization={organization} />
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Multisig proposals</h2>
          {closed.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowClosed((value) => !value)}>
              {showClosed ? "Hide" : "Show"} {closed.length} closed
            </Button>
          )}
        </div>
        <Card className="py-2">
          <CardContent>
            {open.length === 0 && !showClosed ? (
              <p className="text-muted-foreground py-4 text-center text-sm">No open proposal.</p>
            ) : (
              <ul className="divide-y">
                {[...open, ...(showClosed ? closed : [])].map((proposal) => (
                  <ProposalRow
                    key={String(proposal.id)}
                    proposal={proposal}
                    organization={organization}
                    isAdmin={isAdmin}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/** `/organization/:address` (public) or `/organization` (the connected person's organization). */
export function OrganizationPage() {
  const params = useParams();
  const roles = useRoles();
  const param = params.address && isAddress(params.address) ? getAddress(params.address) : undefined;
  const address = param ?? roles.organization?.address;

  if (!address) {
    return (
      <EmptyState icon={<BuildingIcon />} title="You do not belong to any organization">
        Ask the admins of your organization to add your wallet, or create a new organization in{" "}
        <Link to="/governance" className="underline">
          Federation governance
        </Link>
        .
      </EmptyState>
    );
  }
  return <OrganizationView key={address} address={address} />;
}
