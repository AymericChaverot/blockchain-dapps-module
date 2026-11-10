import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { chain, isConfigured } from "@/config/network";
import { type OrganizationSummary, fetchAffiliation, isActiveStatus } from "@/lib/governance";

/**
 * What a page may require from the visitor:
 * - `public`: anyone, no wallet (verification, organization directory, governance)
 * - `wallet`: any connected wallet (a worker's own credentials)
 * - `issuer`: an issuing member of an organization (active or suspended)
 * - `affiliated`: anyone holding a role in an organization (admin or member)
 * - `orgAdmin`: an admin of an organization (its internal multisig)
 *
 * There is no "registry admin": the federation is governed by the
 * organizations themselves.
 */
export type Requirement = "public" | "wallet" | "issuer" | "affiliated" | "orgAdmin";

export interface Roles {
  address?: Address;
  isConnected: boolean;
  wrongChain: boolean;
  /** Organization the wallet belongs to (one at most). */
  organization?: OrganizationSummary;
  /** Admin of its organization (votes in its multisig). */
  isOrgAdmin: boolean;
  /** Issuing member of its organization (active or suspended). */
  isIssuer: boolean;
  /** Issuing member of an ACTIVE organization: may issue right now. */
  isActiveIssuer: boolean;
  /** Its organization is accredited (ACTIVE). */
  organizationActive: boolean;
  isLoading: boolean;
  satisfies: (requirement: Requirement) => boolean;
  /** Human label of the most privileged role. */
  primaryRole: string;
}

export function useAffiliation(address: Address | undefined) {
  return useQuery({
    queryKey: ["affiliation", address],
    queryFn: () => fetchAffiliation(address as Address),
    enabled: isConfigured && !!address,
  });
}

/** Roles of the connected wallet, derived from on-chain state only. */
export function useRoles(): Roles {
  const { address, isConnected, chainId } = useAccount();
  const affiliation = useAffiliation(address);

  const organization = affiliation.data?.organization;
  const isOrgAdmin = !!affiliation.data?.isAdmin;
  const isIssuer = !!affiliation.data?.isMember;
  const organizationActive = !!organization && isActiveStatus(organization.status);
  const connected = isConnected && !!address;

  const satisfies = (requirement: Requirement) => {
    switch (requirement) {
      case "public":
        return true;
      case "wallet":
        return connected;
      case "issuer":
        return connected && isIssuer;
      case "affiliated":
        return connected && !!organization;
      case "orgAdmin":
        return connected && isOrgAdmin;
    }
  };

  return {
    address,
    isConnected: connected,
    wrongChain: connected && chainId !== chain.id,
    organization,
    isOrgAdmin,
    isIssuer,
    isActiveIssuer: isIssuer && organizationActive,
    organizationActive,
    isLoading: !!address && affiliation.isLoading,
    satisfies,
    primaryRole: !connected
      ? "Visitor"
      : isOrgAdmin && isIssuer
        ? "Organization admin & issuer"
        : isOrgAdmin
          ? "Organization admin"
          : isIssuer
            ? "Issuer"
            : "Worker",
  };
}
