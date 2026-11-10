import { type Address, type ContractFunctionReturnType, isAddressEqual, zeroAddress } from "viem";

import { issuerRegistryAbi, organizationAbi } from "@/config/abis";
import { requireContracts } from "@/config/network";
import { publicClient } from "@/config/wagmi";

/**
 * Read layer of the self-governed federation: organizations (one
 * {Organization} multisig contract each), their people, and the proposals of
 * the federation and of each organization. Plain eth_calls, no wallet.
 */

export type OrganizationInfo = ContractFunctionReturnType<typeof issuerRegistryAbi, "view", "getOrganization">;
export type FederationProposal = ContractFunctionReturnType<typeof issuerRegistryAbi, "view", "getProposal">;
export type OrganizationProposal = ContractFunctionReturnType<typeof organizationAbi, "view", "getProposal">;

/** IIssuerRegistry.OrganizationStatus */
export const ORG_STATUS = { NONE: 0, PENDING: 1, ACTIVE: 2, SUSPENDED: 3 } as const;

/** IssuerRegistry.ProposalKind */
export const FEDERATION_KIND = { ADMIT: 0, UPDATE: 1, SUSPEND: 2, REINSTATE: 3, SET_QUORUM: 4 } as const;

/** Organization.Action */
export const ORG_ACTION = {
  ADD_MEMBER: 0,
  REMOVE_MEMBER: 1,
  ADD_ADMIN: 2,
  REMOVE_ADMIN: 3,
  SET_THRESHOLD: 4,
  APPROVE_FEDERATION_PROPOSAL: 5,
  REVOKE_FEDERATION_APPROVAL: 6,
} as const;

export const ORG_STATUS_LABEL: Record<number, string> = {
  [ORG_STATUS.NONE]: "Unknown",
  [ORG_STATUS.PENDING]: "Pending admission",
  [ORG_STATUS.ACTIVE]: "Active",
  [ORG_STATUS.SUSPENDED]: "Suspended",
};

export const FEDERATION_KIND_LABEL: Record<number, string> = {
  [FEDERATION_KIND.ADMIT]: "Admit organization",
  [FEDERATION_KIND.UPDATE]: "Update name / domain",
  [FEDERATION_KIND.SUSPEND]: "Suspend organization",
  [FEDERATION_KIND.REINSTATE]: "Reinstate organization",
  [FEDERATION_KIND.SET_QUORUM]: "Change quorum",
};

export const ORG_ACTION_LABEL: Record<number, string> = {
  [ORG_ACTION.ADD_MEMBER]: "Add issuing member",
  [ORG_ACTION.REMOVE_MEMBER]: "Remove issuing member",
  [ORG_ACTION.ADD_ADMIN]: "Add admin",
  [ORG_ACTION.REMOVE_ADMIN]: "Remove admin",
  [ORG_ACTION.SET_THRESHOLD]: "Change threshold",
  [ORG_ACTION.APPROVE_FEDERATION_PROPOSAL]: "Vote for federation proposal",
  [ORG_ACTION.REVOKE_FEDERATION_APPROVAL]: "Withdraw federation vote",
};

export interface OrganizationSummary extends OrganizationInfo {
  address: Address;
  admins: readonly Address[];
  members: readonly Address[];
  threshold: number;
}

export function isActiveStatus(status: number): boolean {
  return status === ORG_STATUS.ACTIVE;
}

export async function fetchOrganization(address: Address): Promise<OrganizationSummary> {
  const registry = requireContracts().issuerRegistry;
  const [info, admins, members, threshold] = await Promise.all([
    publicClient.readContract({ address: registry, abi: issuerRegistryAbi, functionName: "getOrganization", args: [address] }),
    publicClient.readContract({ address, abi: organizationAbi, functionName: "getAdmins" }),
    publicClient.readContract({ address, abi: organizationAbi, functionName: "getMembers" }),
    publicClient.readContract({ address, abi: organizationAbi, functionName: "threshold" }),
  ]);
  return { ...info, address, admins, members, threshold: Number(threshold) };
}

export async function fetchOrganizationProposals(address: Address): Promise<readonly OrganizationProposal[]> {
  return publicClient.readContract({ address, abi: organizationAbi, functionName: "getProposals" });
}

/** Everything the governance pages need, in one query. */
export async function fetchFederation() {
  const address = requireContracts().issuerRegistry;
  const read = <N extends "quorumBps" | "activeOrganizationCount" | "proposalLifetime" | "timelockDelay">(
    functionName: N,
  ) => publicClient.readContract({ address, abi: issuerRegistryAbi, functionName });

  const [quorumBps, activeCount, proposalLifetime, timelockDelay, accounts, proposals] = await Promise.all([
    read("quorumBps"),
    read("activeOrganizationCount"),
    read("proposalLifetime"),
    read("timelockDelay"),
    publicClient.readContract({ address, abi: issuerRegistryAbi, functionName: "getOrganizationAccounts" }),
    publicClient.readContract({ address, abi: issuerRegistryAbi, functionName: "getProposals" }),
  ]);
  const organizations = await Promise.all(accounts.map((account) => fetchOrganization(account)));
  return {
    registry: address,
    quorumBps: Number(quorumBps),
    activeCount: Number(activeCount),
    proposalLifetime: Number(proposalLifetime),
    timelockDelay: Number(timelockDelay),
    organizations,
    proposals,
  };
}

export type Federation = Awaited<ReturnType<typeof fetchFederation>>;

/** The organization a person belongs to (as admin and/or issuing member), if any. */
export async function fetchAffiliation(account: Address) {
  const org = await publicClient.readContract({
    address: requireContracts().issuerRegistry,
    abi: issuerRegistryAbi,
    functionName: "organizationOf",
    args: [account],
  });
  if (isAddressEqual(org, zeroAddress)) return null;
  const organization = await fetchOrganization(org);
  return {
    organization,
    isAdmin: organization.admins.some((admin) => isAddressEqual(admin, account)),
    isMember: organization.members.some((member) => isAddressEqual(member, account)),
  };
}

export type Affiliation = NonNullable<Awaited<ReturnType<typeof fetchAffiliation>>>;

export function organizationName(organizations: readonly OrganizationSummary[], address: Address): string {
  return organizations.find((org) => isAddressEqual(org.address, address))?.name ?? address;
}

/** Lifecycle of a proposal (federation or organization) at `now` (unix seconds). */
export type ProposalPhase = "executed" | "expired" | "collecting" | "timelocked" | "executable";

export function proposalPhase(
  proposal: {
    executed: boolean;
    expired: boolean;
    expiresAt: bigint;
    readyAt: bigint;
    executableAt: bigint;
    approvals: bigint;
    required: bigint;
  },
  now = Math.floor(Date.now() / 1000),
): ProposalPhase {
  if (proposal.executed) return "executed";
  if (proposal.expired || BigInt(now) >= proposal.expiresAt) return "expired";
  if (proposal.approvals < proposal.required) return "collecting";
  if (proposal.readyAt > 0n && BigInt(now) < proposal.executableAt) return "timelocked";
  return "executable";
}
