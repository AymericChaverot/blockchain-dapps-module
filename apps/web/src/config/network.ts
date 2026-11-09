import { type Address, type Chain, getAddress, isAddress } from "viem";
import { baseSepolia, hardhat } from "viem/chains";

import deployments from "./deployments.json";

/**
 * Target network, chosen with VITE_NETWORK in the root `.env` (or forced by
 * `pnpm web:local` / `pnpm web:base-sepolia`). The app talks to exactly one
 * chain at a time.
 */
export type NetworkName = "localhost" | "baseSepolia";

export const NETWORK: NetworkName = import.meta.env.VITE_NETWORK === "baseSepolia" ? "baseSepolia" : "localhost";

const CHAINS: Record<NetworkName, Chain> = {
  localhost: hardhat,
  baseSepolia,
};

const DEFAULT_RPC: Record<NetworkName, string> = {
  localhost: "http://127.0.0.1:8545",
  baseSepolia: "https://sepolia.base.org",
};

export const chain: Chain = CHAINS[NETWORK];

const configuredRpcUrl: string =
  (NETWORK === "baseSepolia" ? import.meta.env.VITE_BASE_SEPOLIA_RPC_URL : import.meta.env.VITE_LOCAL_RPC_URL) ||
  DEFAULT_RPC[NETWORK];

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * A phone on the LAN cannot reach the dev machine's 127.0.0.1:8545: in that
 * case the local chain is reached through the Vite dev server proxy (/rpc).
 */
function resolveRpcUrl(url: string): string {
  try {
    const target = new URL(url);
    if (LOOPBACK.test(target.hostname) && !LOOPBACK.test(window.location.hostname)) {
      return `${window.location.origin}/rpc`;
    }
  } catch {
    // Relative or invalid URL: use as is.
  }
  return url;
}

/** Public RPC used for every read; the verifier never needs a wallet. */
export const rpcUrl: string = resolveRpcUrl(configuredRpcUrl);

interface DeploymentRecord {
  issuerRegistry: string;
  siteCredentialManager: string;
  deploymentBlock: number;
  registryAdmin?: string;
}

const record = (deployments as Record<string, DeploymentRecord | undefined>)[String(chain.id)];

function pickAddress(override: string | undefined, fallback: string | undefined): Address | undefined {
  const value = override?.trim() || fallback;
  return value && isAddress(value) ? getAddress(value) : undefined;
}

export const contracts = {
  issuerRegistry: pickAddress(import.meta.env.VITE_ISSUER_REGISTRY_ADDRESS, record?.issuerRegistry),
  siteCredentialManager: pickAddress(
    import.meta.env.VITE_SITE_CREDENTIAL_MANAGER_ADDRESS,
    record?.siteCredentialManager,
  ),
};

export const isConfigured = Boolean(contracts.issuerRegistry && contracts.siteCredentialManager);

export const networkLabel = NETWORK === "baseSepolia" ? "Base Sepolia" : "Local Hardhat";

const explorerBase = chain.blockExplorers?.default.url;

export function explorerTxUrl(hash: string): string | undefined {
  return explorerBase ? `${explorerBase}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(address: string): string | undefined {
  return explorerBase ? `${explorerBase}/address/${address}` : undefined;
}

/** Contract addresses that are guaranteed to exist once `isConfigured` is true. */
export function requireContracts(): { issuerRegistry: Address; siteCredentialManager: Address } {
  if (!contracts.issuerRegistry || !contracts.siteCredentialManager) {
    throw new Error(`SitePass is not deployed on ${networkLabel} yet.`);
  }
  return { issuerRegistry: contracts.issuerRegistry, siteCredentialManager: contracts.siteCredentialManager };
}
