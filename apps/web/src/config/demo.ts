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
  /** Issuing organization (contract). */
  issuer: Address;
  /** Member who signed it. */
  signer: Address;
  holder: Address;
  clearanceCode: string;
  documentHash: Hex;
  expiresAt: number;
  document?: { fileName: string; content: string };
}

export interface DemoSeedActors {
  deployer: Address;
  issuerA: Address;
  issuerA2?: Address;
  issuerB: Address;
  adminA1: Address;
  adminA2?: Address;
  adminB: Address;
  adminC?: Address;
  holder: Address;
  attacker: Address;
}

export interface DemoSeedOrganization {
  key: string;
  address: Address;
  name: string;
  domain: string;
  admins: Address[];
  threshold: number;
  members: Address[];
}

export interface DemoSeed {
  network: string;
  chainId: number;
  seededAt?: string;
  actors: DemoSeedActors;
  organizations: DemoSeedOrganization[];
  credentials: DemoSeedCredential[];
}

const loaders = import.meta.glob<Record<string, DemoSeed>>("./demo-seed.json", { import: "default" });

async function loadDemoSeed(): Promise<DemoSeed | null> {
  const loader = loaders["./demo-seed.json"];
  if (!loader) return null;
  const seed = (await loader())[String(chain.id)];
  // Seeds written before the federation model have no organizations: ignore them.
  return seed?.organizations ? seed : null;
}

export function useDemoSeed(enabled = true) {
  return useQuery({ queryKey: ["demo-seed"], queryFn: loadDemoSeed, staleTime: Number.POSITIVE_INFINITY, enabled });
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/**
 * Hardhat's well-known default accounts #0..#9 (mnemonic "test test ... junk").
 * They are public and only hold value on a local chain, which is why the
 * built-in demo wallet is limited to chain 31337.
 */
const HARDHAT_ADDRESSES: Address[] = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // #0 deployer (no role)
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // #1 issuer A
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // #2 issuer B
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // #3 holder
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // #4 attacker
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", // #5 admin A1
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9", // #6 admin A2
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", // #7 admin B
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", // #8 issuer A2
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720", // #9 admin C (candidate)
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
        "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
        "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
        "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
        "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
        "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
      ];

export const LOCAL_DEMO_WALLET_AVAILABLE = chain.id === 31337;

/** Private keys the built-in demo wallet may sign with (local chain only). */
export const DEMO_WALLET_KEYS: Hex[] = LOCAL_DEMO_WALLET_AVAILABLE ? HARDHAT_KEYS : [];

export type PersonaId =
  | "adminA1"
  | "adminA2"
  | "issuerA"
  | "issuerA2"
  | "adminB"
  | "issuerB"
  | "adminC"
  | "holder"
  | "outsider";

export interface Persona {
  id: PersonaId;
  label: string;
  role: string;
  /** Organization the persona belongs to, when any. */
  organization?: string;
  description: string;
  address: Address;
  /** True when the built-in demo wallet can sign for this persona. */
  builtIn: boolean;
}

export function buildPersonas(seed: DemoSeed | null | undefined): Persona[] {
  const h = LOCAL_DEMO_WALLET_AVAILABLE ? HARDHAT_ADDRESSES : [];
  const actors: Partial<DemoSeedActors> = seed?.actors ?? {
    deployer: h[0],
    issuerA: h[1],
    issuerB: h[2],
    holder: h[3],
    attacker: h[4],
    adminA1: h[5],
    adminA2: h[6],
    adminB: h[7],
    issuerA2: h[8],
    adminC: h[9],
  };
  const orgA = seed?.organizations.find((org) => org.key === "a");
  const orgB = seed?.organizations.find((org) => org.key === "b");
  const nameA = orgA?.name ?? "Issuer A";
  const nameB = orgB?.name ?? "Issuer B";
  const thresholdA = orgA ? `${orgA.threshold}-of-${orgA.admins.length}` : "2-of-2";

  const list: (Omit<Persona, "builtIn" | "address"> & { address?: Address })[] = [
    {
      id: "adminA1",
      label: "Admin A1",
      role: "Organization admin",
      organization: nameA,
      description: `Proposes changes in ${nameA}'s ${thresholdA} multisig and federation votes.`,
      address: actors.adminA1,
    },
    {
      id: "adminA2",
      label: "Admin A2",
      role: "Organization admin",
      organization: nameA,
      description: `Second signer of ${nameA}: nothing happens in the organization without them.`,
      address: actors.adminA2,
    },
    {
      id: "issuerA",
      label: "Trainer A",
      role: "Issuing member",
      organization: nameA,
      description: `Issues and revokes clearances on behalf of ${nameA}. Signed the seeded credentials.`,
      address: actors.issuerA,
    },
    {
      id: "issuerA2",
      label: "Trainer A2",
      role: "Issuing member",
      organization: nameA,
      description: `A colleague: can revoke any credential ${nameA} issued, even one signed by Trainer A.`,
      address: actors.issuerA2,
    },
    {
      id: "adminB",
      label: "Admin B",
      role: "Organization admin",
      organization: nameB,
      description: `Single admin (1-of-1) of ${nameB}: casts its federation vote alone.`,
      address: actors.adminB,
    },
    {
      id: "issuerB",
      label: "Trainer B",
      role: "Issuing member",
      organization: nameB,
      description: `Issues for ${nameB}; cannot revoke what another organization issued.`,
      address: actors.issuerB,
    },
    {
      id: "adminC",
      label: "Admin C",
      role: "Candidate",
      description: "Creates a new organization and applies for admission: the federation votes.",
      address: actors.adminC,
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

  return (
    list
      .filter((persona): persona is typeof persona & { address: Address } => !!persona.address)
      // On Base Sepolia the "attacker" defaults to the holder: keep one entry.
      .filter((persona) => persona.id !== "outsider" || !actors.holder || !isAddressEqual(persona.address, actors.holder))
      .map((persona) => ({
        ...persona,
        address: getAddress(persona.address),
        builtIn:
          DEMO_WALLET_KEYS.length > 0 && HARDHAT_ADDRESSES.some((address) => isAddressEqual(address, persona.address)),
      }))
  );
}
