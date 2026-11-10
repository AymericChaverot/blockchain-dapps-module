import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { type Address, type Hex, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const REPO_ROOT = path.resolve(CONTRACTS_DIR, "../..");

/** Local networks use Hardhat's well-known default accounts. */
const LOCAL_NETWORKS = new Set(["localhost", "hardhat", "default"]);

/** Governance defaults (seconds). Local: short timelock so it can be shown live. */
const LOCAL_PROPOSAL_LIFETIME = 24 * 3600;
const LOCAL_TIMELOCK_DELAY = 60;
const PUBLIC_PROPOSAL_LIFETIME = 7 * 24 * 3600;
const PUBLIC_TIMELOCK_DELAY = 2 * 24 * 3600;
/** Strict majority. */
export const INITIAL_QUORUM_BPS = 5_000;

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireEnv(name: string, networkName: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(
      `Missing ${name} in the root .env file (required on network "${networkName}"). Run "pnpm env:keys" to generate it.`,
    );
  }
  return value;
}

function addressFromPrivateKey(name: string, networkName: string): Address {
  const key = requireEnv(name, networkName);
  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  return privateKeyToAccount(normalized).address;
}

function optionalAddressFromPrivateKey(name: string): Address | undefined {
  const key = env(name);
  if (!key) return undefined;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex).address;
}

function optionalAddress(name: string): Address | undefined {
  const value = env(name);
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

function seconds(name: string, fallback: number): number {
  const raw = Number(env(name) ?? fallback);
  if (!Number.isInteger(raw) || raw < 0) throw new Error(`${name} must be a number of seconds, got "${env(name)}"`);
  return raw;
}

/**
 * People of the demo. Every privileged role is held by a person (wallet)
 * inside an organization; there is no registry admin anymore.
 */
export interface DemoActors {
  /** Deploys the contracts. Keeps no power afterwards. */
  deployer: Address;
  /** Trainer (issuing member) of organization A. Signs the seed credentials. */
  issuerA: Address;
  /** Second trainer of organization A (shows colleague revocation). Optional on public networks. */
  issuerA2?: Address;
  /** Trainer (issuing member) of organization B. */
  issuerB: Address;
  /** Admins of organization A: its 2-of-2 multisig (1-of-1 if only one is configured). */
  adminA1: Address;
  adminA2?: Address;
  /** Admin of organization B (1-of-1). */
  adminB: Address;
  /** Admin of a candidate organization C, created and admitted live during the demo. */
  adminC?: Address;
  /** Worker. */
  holder: Address;
  /** Wallet with no role, for the failure demos. */
  attacker: Address;
}

export interface FoundingOrganizationConfig {
  key: "a" | "b";
  name: string;
  domain: string;
  admins: Address[];
  threshold: bigint;
  members: Address[];
}

/**
 * Opens the connection selected with `--network` and resolves the demo
 * actors:
 *   - localhost / hardhat: Hardhat default accounts #0..#9
 *   - baseSepolia: addresses derived from the private keys in `.env`
 */
export async function getContext() {
  const connection = await network.getOrCreate();
  const { viem, networkName } = connection;
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const isLocal = LOCAL_NETWORKS.has(networkName);

  let addresses: DemoActors;

  if (isLocal) {
    const wallets = await viem.getWalletClients();
    const [deployer, issuerA, issuerB, holder, attacker, adminA1, adminA2, adminB, issuerA2, adminC] = wallets.map(
      (wallet) => getAddress(wallet.account.address),
    );
    addresses = { deployer, issuerA, issuerB, holder, attacker, adminA1, adminA2, adminB, issuerA2, adminC };
  } else {
    const holder = optionalAddress("HOLDER_ADDRESS");
    if (!holder) throw new Error(`Missing HOLDER_ADDRESS in the root .env file (required on "${networkName}").`);
    addresses = {
      deployer: addressFromPrivateKey("DEPLOYER_PRIVATE_KEY", networkName),
      issuerA: addressFromPrivateKey("ISSUER_A_PRIVATE_KEY", networkName),
      issuerA2: optionalAddressFromPrivateKey("ISSUER_A2_PRIVATE_KEY"),
      issuerB: addressFromPrivateKey("ISSUER_B_PRIVATE_KEY", networkName),
      adminA1: addressFromPrivateKey("ADMIN_A1_PRIVATE_KEY", networkName),
      adminA2: optionalAddressFromPrivateKey("ADMIN_A2_PRIVATE_KEY"),
      adminB: addressFromPrivateKey("ADMIN_B_PRIVATE_KEY", networkName),
      adminC: optionalAddressFromPrivateKey("ADMIN_C_PRIVATE_KEY"),
      holder,
      // Any account with no role works for the failure demos.
      attacker: optionalAddress("ATTACKER_ADDRESS") ?? holder,
    };
  }

  const adminsA = [addresses.adminA1, ...(addresses.adminA2 ? [addresses.adminA2] : [])];
  const organizations: FoundingOrganizationConfig[] = [
    {
      key: "a",
      name: env("ISSUER_A_NAME") ?? "Issuer A",
      domain: env("ISSUER_A_DOMAIN") ?? "issuer-a.example",
      admins: adminsA,
      threshold: BigInt(adminsA.length),
      members: [addresses.issuerA, ...(addresses.issuerA2 ? [addresses.issuerA2] : [])],
    },
    {
      key: "b",
      name: env("ISSUER_B_NAME") ?? "Issuer B",
      domain: env("ISSUER_B_DOMAIN") ?? "issuer-b.example",
      admins: [addresses.adminB],
      threshold: 1n,
      members: [addresses.issuerB],
    },
  ];

  const governance = {
    proposalLifetime: seconds(
      "GOVERNANCE_PROPOSAL_LIFETIME",
      isLocal ? LOCAL_PROPOSAL_LIFETIME : PUBLIC_PROPOSAL_LIFETIME,
    ),
    timelockDelay: seconds("GOVERNANCE_TIMELOCK_DELAY", isLocal ? LOCAL_TIMELOCK_DELAY : PUBLIC_TIMELOCK_DELAY),
    initialQuorumBps: INITIAL_QUORUM_BPS,
  };
  if (governance.timelockDelay >= governance.proposalLifetime) {
    throw new Error("GOVERNANCE_TIMELOCK_DELAY must be shorter than GOVERNANCE_PROPOSAL_LIFETIME.");
  }

  return {
    connection,
    viem,
    networkName,
    chainId,
    isLocal,
    publicClient,
    addresses,
    organizations,
    governance,
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
