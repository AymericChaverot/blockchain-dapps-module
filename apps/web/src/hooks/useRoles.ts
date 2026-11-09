import { useQuery } from "@tanstack/react-query";
import { type Address, isAddressEqual } from "viem";
import { useAccount } from "wagmi";

import { chain, isConfigured } from "@/config/network";
import { fetchIssuer, fetchRegistryOverview } from "@/lib/credentials";

/**
 * What a page may require from the visitor:
 * - `public`: anyone, no wallet (verification, issuer directory)
 * - `wallet`: any connected wallet (a worker's own credentials)
 * - `issuer`: a wallet registered in the issuer registry
 * - `admin`: the registry owner (multisig in production)
 */
export type Requirement = "public" | "wallet" | "issuer" | "admin";

export interface Roles {
  address?: Address;
  isConnected: boolean;
  wrongChain: boolean;
  isAdmin: boolean;
  /** Registered in the registry, active or suspended. */
  isIssuer: boolean;
  isActiveIssuer: boolean;
  issuerName?: string;
  isLoading: boolean;
  satisfies: (requirement: Requirement) => boolean;
  /** Human label of the most privileged role. */
  primaryRole: string;
}

/** Roles of the connected wallet, derived from on-chain state only. */
export function useRoles(): Roles {
  const { address, isConnected, chainId } = useAccount();

  const registry = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistryOverview,
    enabled: isConfigured,
  });
  const issuer = useQuery({
    queryKey: ["issuer", address],
    queryFn: () => fetchIssuer(address as Address),
    enabled: isConfigured && !!address,
  });

  const isAdmin = !!address && !!registry.data && isAddressEqual(address, registry.data.owner);
  const isIssuer = !!issuer.data?.registered;
  const isActiveIssuer = isIssuer && !!issuer.data?.active;
  const connected = isConnected && !!address;

  const satisfies = (requirement: Requirement) => {
    switch (requirement) {
      case "public":
        return true;
      case "wallet":
        return connected;
      case "issuer":
        return connected && isIssuer;
      case "admin":
        return connected && isAdmin;
    }
  };

  return {
    address,
    isConnected: connected,
    wrongChain: connected && chainId !== chain.id,
    isAdmin,
    isIssuer,
    isActiveIssuer,
    issuerName: issuer.data?.name || undefined,
    isLoading: registry.isLoading || (!!address && issuer.isLoading),
    satisfies,
    primaryRole: !connected ? "Visitor" : isAdmin ? "Registry admin" : isIssuer ? "Issuer" : "Worker",
  };
}
