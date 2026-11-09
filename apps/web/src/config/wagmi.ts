import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { demoWallet } from "@/lib/demoWallet";

import { DEMO_WALLET_KEYS } from "./demo";
import { BUILD_MODE } from "./mode";
import { chain, rpcUrl } from "./network";

/**
 * Stand-alone public client used by every read in the app. It talks to the
 * RPC endpoint directly: no injected provider, no wallet, no account.
 */
export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

/** The built-in persona wallet only exists in demo builds on the local chain. */
const demoConnectors =
  BUILD_MODE === "demo" && DEMO_WALLET_KEYS.length > 0 ? [demoWallet({ keys: DEMO_WALLET_KEYS, rpcUrl })] : [];

/** Wallet layer, only used by the issuer, holder and registry admin pages. */
export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected(), ...demoConnectors],
  transports: { [chain.id]: http(rpcUrl) },
  multiInjectedProviderDiscovery: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
