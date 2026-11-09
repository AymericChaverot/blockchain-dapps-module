import { useQuery } from "@tanstack/react-query";
import { type Address, type Hex, getAddress, isAddressEqual } from "viem";

import { chain } from "./network";

/**
 * Demo fixtures written by the seed script (`pnpm deploy:*` / `pnpm seed:*`)
 * into `demo-seed.json`, keyed by chain id. The file is optional and loaded
 * lazily, so a production build never downloads it.
 */
export interface DemoSeedCredential {
  key: string;
  scenario: string;
  id: Hex;
  issuer: Address;
  holder: Address;
  clearanceCode: string;
  documentHash: Hex;
  expiresAt: number;
  document?: { fileName: string; content: string };
}

export interface DemoSeed {
  network: string;
  chainId: number;
  seededAt?: string;
  actors: { deployer: Address; issuerA: Address; issuerB: Address; holder: Address; attacker: Address };
  issuers: { a: { name: string; domain: string }; b: { name: string; domain: string } };
  credentials: DemoSeedCredential[];
}

const loaders = import.meta.glob<Record<string, DemoSeed>>("./demo-seed.json", { import: "default" });

async function loadDemoSeed(): Promise<DemoSeed | null> {
  const loader = loaders["./demo-seed.json"];
  if (!loader) return null;
  return (await loader())[String(chain.id)] ?? null;
}

export function useDemoSeed(enabled = true) {
  return useQuery({ queryKey: ["demo-seed"], queryFn: loadDemoSeed, staleTime: Number.POSITIVE_INFINITY, enabled });
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/**
 * Hardhat's well-known default accounts (mnemonic "test test ... junk"). They
 * are public and only hold value on a local chain, which is why the built-in
 * demo wallet is limited to chain 31337.
 */
const HARDHAT_ADDRESSES: Address[] = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
];

/** Matching private keys. Compiled out of production builds (dead branch). */
const HARDHAT_KEYS: Hex[] =
  import.meta.env.VITE_APP_MODE === "production"
    ? []
    : [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
        "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
        "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
      ];

export const LOCAL_DEMO_WALLET_AVAILABLE = chain.id === 31337;

/** Private keys the built-in demo wallet may sign with (local chain only). */
export const DEMO_WALLET_KEYS: Hex[] = LOCAL_DEMO_WALLET_AVAILABLE ? HARDHAT_KEYS : [];

export type PersonaId = "admin" | "issuerA" | "issuerB" | "holder" | "outsider";

export interface Persona {
  id: PersonaId;
  label: string;
  role: string;
  description: string;
  address: Address;
  /** True when the built-in demo wallet can sign for this persona. */
  builtIn: boolean;
}

export function buildPersonas(seed: DemoSeed | null | undefined, registryOwner?: Address): Persona[] {
  const fallback = LOCAL_DEMO_WALLET_AVAILABLE ? HARDHAT_ADDRESSES : [];
  const actors = seed?.actors ?? {
    deployer: fallback[0],
    issuerA: fallback[1],
    issuerB: fallback[2],
    holder: fallback[3],
    attacker: fallback[4],
  };
  const issuerA = seed?.issuers.a.name ?? "Issuer A";
  const issuerB = seed?.issuers.b.name ?? "Issuer B";
  const admin = registryOwner ?? actors.deployer;

  const list: Omit<Persona, "builtIn">[] = [
    {
      id: "admin",
      label: "Registry admin",
      role: "Governance",
      description: "Accredits, suspends and reinstates training organizations.",
      address: admin,
    },
    {
      id: "issuerA",
      label: issuerA,
      role: "Issuer",
      description: "Issues and revokes clearances. Issuer of the seeded valid credentials.",
      address: actors.issuerA,
    },
    {
      id: "issuerB",
      label: issuerB,
      role: "Issuer",
      description: "A second issuer: cannot revoke what another organization issued.",
      address: actors.issuerB,
    },
    {
      id: "holder",
      label: "Worker Test",
      role: "Worker",
      description: "Holds the seeded credentials; signs proof-of-control challenges.",
      address: actors.holder,
    },
    {
      id: "outsider",
      label: "Unaccredited wallet",
      role: "Outsider",
      description: "Any other wallet: every privileged action is rejected by the contracts.",
      address: actors.attacker,
    },
  ];

  return list
    .filter((persona) => !!persona.address)
    // On Base Sepolia the "attacker" defaults to the holder: keep one entry.
    .filter((persona) => persona.id !== "outsider" || !isAddressEqual(persona.address, actors.holder))
    .map((persona) => ({
      ...persona,
      address: getAddress(persona.address),
      builtIn: DEMO_WALLET_KEYS.length > 0 && HARDHAT_ADDRESSES.some((address) => isAddressEqual(address, persona.address)),
    }));
}
