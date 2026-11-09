import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { type Address, type Hex, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const REPO_ROOT = path.resolve(CONTRACTS_DIR, "../..");

/** Local networks use Hardhat's well-known default accounts. */
const LOCAL_NETWORKS = new Set(["localhost", "hardhat", "default"]);

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireEnv(name: string, networkName: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing ${name} in the root .env file (required on network "${networkName}").`);
  }
  return value;
}

function addressFromPrivateKey(name: string, networkName: string): Address {
  const key = requireEnv(name, networkName);
  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  return privateKeyToAccount(normalized).address;
}

function optionalAddress(name: string): Address | undefined {
  const value = env(name);
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

export interface DemoIssuerConfig {
  name: string;
  domain: string;
}

/**
 * Opens the connection selected with `--network` and resolves the demo
 * actors:
 *   - localhost / hardhat: Hardhat default accounts #0..#4
 *   - baseSepolia: addresses derived from the private keys in `.env`
 */
export async function getContext() {
  const connection = await network.getOrCreate();
  const { viem, networkName } = connection;
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const isLocal = LOCAL_NETWORKS.has(networkName);

  let addresses: { deployer: Address; issuerA: Address; issuerB: Address; holder: Address; attacker: Address };

  if (isLocal) {
    const wallets = await viem.getWalletClients();
    const [deployer, issuerA, issuerB, holder, attacker] = wallets.map((wallet) => getAddress(wallet.account.address));
    addresses = { deployer, issuerA, issuerB, holder, attacker };
  } else {
    const deployer = addressFromPrivateKey("DEPLOYER_PRIVATE_KEY", networkName);
    const holder = optionalAddress("HOLDER_ADDRESS");
    if (!holder) throw new Error(`Missing HOLDER_ADDRESS in the root .env file (required on "${networkName}").`);
    addresses = {
      deployer,
      issuerA: addressFromPrivateKey("ISSUER_A_PRIVATE_KEY", networkName),
      issuerB: addressFromPrivateKey("ISSUER_B_PRIVATE_KEY", networkName),
      holder,
      // Any account that is not an issuer works for the failure demos.
      attacker: optionalAddress("ATTACKER_ADDRESS") ?? holder,
    };
  }

  const issuers: { a: DemoIssuerConfig; b: DemoIssuerConfig } = {
    a: { name: env("ISSUER_A_NAME") ?? "Apave Formation (demo)", domain: env("ISSUER_A_DOMAIN") ?? "apave.com" },
    b: { name: env("ISSUER_B_NAME") ?? "Dekra Industrial (demo)", domain: env("ISSUER_B_DOMAIN") ?? "dekra.com" },
  };

  return {
    connection,
    viem,
    networkName,
    chainId,
    isLocal,
    publicClient,
    addresses,
    issuers,
    registryAdmin: optionalAddress("REGISTRY_ADMIN_ADDRESS"),
  };
}

export type ScriptContext = Awaited<ReturnType<typeof getContext>>;

/** Waits for a transaction and fails loudly if it reverted. */
export async function waitTx(ctx: ScriptContext, hashPromise: Promise<Hex>, label: string): Promise<Hex> {
  const hash = await hashPromise;
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted (tx ${hash})`);
  console.log(`  ✔ ${label}  ${explorerTx(ctx, hash)}`);
  return hash;
}

export function explorerTx(ctx: { chainId: number }, hash: Hex): string {
  return ctx.chainId === 84532 ? `https://sepolia.basescan.org/tx/${hash}` : hash;
}

export function explorerAddress(ctx: { chainId: number }, address: Address): string {
  return ctx.chainId === 84532 ? `https://sepolia.basescan.org/address/${address}` : address;
}
