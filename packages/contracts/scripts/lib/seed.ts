import fs from "node:fs";
import path from "node:path";

import {
  CREDENTIAL_STATUS,
  type CredentialDocument,
  buildCredentialDocument,
  credentialDocumentFileName,
  encodeCredentialType,
  hashCredentialDocument,
  serializeCredentialDocument,
} from "@sitepass/shared";
import { type Address, type Hex, formatEther, parseEther } from "viem";

import { REPO_ROOT, type ScriptContext, env, waitTx } from "./context.ts";
import { type DeploymentRecord, WEB_DEMO_SEED_FILE, saveWebDemoSeed } from "./deployments.ts";

/** Off-chain documents are personal data: written locally, git-ignored. */
const DEMO_DIR = path.join(REPO_ROOT, "demo");

/** Minimum balance an issuer should have before seeding on a public network. */
const MIN_ISSUER_BALANCE = parseEther("0.0005");
const ISSUER_TOP_UP = parseEther("0.001");

interface SeedCredentialPlan {
  key: string;
  issuer: "a" | "b";
  clearanceCode: string;
  validityDays: number;
  /** Overrides `validityDays` with a short lifetime in minutes (expiry demo). */
  validityMinutes?: number;
  revokeWithReason?: number;
  scenario: string;
}

const DEMO_HOLDER_IDENTITY = {
  firstName: "Camille",
  lastName: "Martin",
  birthDate: "1991-04-12",
  employer: "Bouygues Construction (demo)",
};

function shortExpiryMinutes(): number {
  const raw = Number(env("SEED_SHORT_EXPIRY_MINUTES") ?? "5");
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function buildPlan(): SeedCredentialPlan[] {
  return [
    {
      key: "valid-nuclear",
      issuer: "a",
      clearanceCode: "NUC-PR1-CC",
      validityDays: 3 * 365,
      scenario: "VALID - radiation protection PR1-CC, shown to the verifier",
    },
    {
      key: "to-revoke-live",
      issuer: "a",
      clearanceCode: "ELEC-B2V",
      validityDays: 3 * 365,
      scenario: "VALID - to be revoked live during the demo",
    },
    {
      key: "short-expiry",
      issuer: "a",
      clearanceCode: "BTP-WORK-AT-HEIGHT",
      validityDays: 0,
      validityMinutes: shortExpiryMinutes(),
      scenario: `EXPIRES ${shortExpiryMinutes()} minutes after seeding`,
    },
    {
      key: "already-revoked",
      issuer: "b",
      clearanceCode: "HAZ-ATEX-1",
      validityDays: 3 * 365,
      revokeWithReason: 2,
      scenario: "REVOKED by the second issuer (MEDICAL_UNFIT)",
    },
  ];
}

/** Registers both demo issuers in the registry (skips the ones already present). */
export async function registerDemoIssuers(ctx: ScriptContext, deployment: DeploymentRecord): Promise<void> {
  const registry = await ctx.viem.getContractAt("IssuerRegistry", deployment.issuerRegistry);
  const owner = (await registry.read.owner()) as Address;
  const admin = await ctx.viem.getWalletClient(owner).catch(() => undefined);

  for (const [key, address] of [
    ["a", ctx.addresses.issuerA],
    ["b", ctx.addresses.issuerB],
  ] as const) {
    const meta = ctx.issuers[key];
    const existing = await registry.read.getIssuer([address]);
    if (existing.registered) {
      console.log(`  • ${meta.name} already registered (${address})`);
      continue;
    }
    if (!admin) {
      console.log(`  ! Cannot register ${meta.name}: registry admin ${owner} is not a local signer (Safe?).`);
      continue;
    }
    await waitTx(
      ctx,
      registry.write.addIssuer([address, meta.name, meta.domain], { account: admin.account }),
      `addIssuer ${meta.name} <${meta.domain}> → ${address}`,
    );
  }
}

async function ensureIssuerGas(ctx: ScriptContext, issuer: Address): Promise<void> {
  if (ctx.isLocal) return;
  const balance = await ctx.publicClient.getBalance({ address: issuer });
  if (balance >= MIN_ISSUER_BALANCE) return;
  const deployer = await ctx.viem.getWalletClient(ctx.addresses.deployer);
  console.log(`  • Topping up issuer ${issuer} (balance ${formatEther(balance)} ETH) with ${formatEther(ISSUER_TOP_UP)} ETH`);
  const hash = await deployer.sendTransaction({ to: issuer, value: ISSUER_TOP_UP });
  await ctx.publicClient.waitForTransactionReceipt({ hash });
}

export interface SeededCredential {
  key: string;
  scenario: string;
  id: Hex;
  issuer: Address;
  holder: Address;
  clearanceCode: string;
  documentHash: Hex;
  documentFile: string;
  expiresAt: number;
}

/** Issues the demo credentials and writes their off-chain JSON documents. */
export async function seedDemoCredentials(ctx: ScriptContext, deployment: DeploymentRecord): Promise<SeededCredential[]> {
  const manager = await ctx.viem.getContractAt("SiteCredentialManager", deployment.siteCredentialManager);
  const registry = await ctx.viem.getContractAt("IssuerRegistry", deployment.issuerRegistry);
  const outDir = path.join(DEMO_DIR, ctx.networkName);
  fs.mkdirSync(outDir, { recursive: true });

  const seeded: SeededCredential[] = [];
  const documents: Record<string, { fileName: string; content: string }> = {};
  for (const [index, plan] of buildPlan().entries()) {
    const issuerAddress = plan.issuer === "a" ? ctx.addresses.issuerA : ctx.addresses.issuerB;
    if (!(await registry.read.isActiveIssuer([issuerAddress]))) {
      console.log(`  ! Skipping "${plan.key}": ${issuerAddress} is not an active issuer.`);
      continue;
    }
    await ensureIssuerGas(ctx, issuerAddress);
    const issuerWallet = await ctx.viem.getWalletClient(issuerAddress);
    const issuerMeta = ctx.issuers[plan.issuer];

    const block = await ctx.publicClient.getBlock();
    const now = new Date(Number(block.timestamp) * 1000);
    const validUntil = plan.validityMinutes
      ? new Date(Date.now() + plan.validityMinutes * 60_000)
      : plan.validityDays > 0
        ? new Date(now.getTime() + plan.validityDays * 86_400_000)
        : undefined;

    const document: CredentialDocument = buildCredentialDocument({
      chainId: ctx.chainId,
      manager: deployment.siteCredentialManager,
      issuer: { address: issuerAddress, name: issuerMeta.name, domain: issuerMeta.domain },
      holder: { address: ctx.addresses.holder, ...DEMO_HOLDER_IDENTITY },
      clearanceCode: plan.clearanceCode,
      training: {
        sessionReference: `SEED-${now.getUTCFullYear()}-${String(index + 1).padStart(3, "0")}`,
        location: "Flamanville training center (demo)",
        completedOn: now.toISOString().slice(0, 10),
        result: "Passed",
      },
      validFrom: now,
      validUntil,
    });
    const documentHash = await hashCredentialDocument(document);
    const expiresAt = validUntil ? Math.floor(validUntil.getTime() / 1000) : 0;
    const id = (await manager.read.computeCredentialId([issuerAddress, documentHash])) as Hex;

    const existing = await manager.read.verifyCredential([id]);
    if (existing.exists) {
      console.log(`  • "${plan.key}" already issued (${id})`);
    } else {
      await waitTx(
        ctx,
        manager.write.issueCredential(
          [ctx.addresses.holder, encodeCredentialType(plan.clearanceCode), documentHash, BigInt(expiresAt)],
          { account: issuerWallet.account },
        ),
        `issueCredential ${plan.clearanceCode} by ${issuerMeta.name}`,
      );
    }

    if (plan.revokeWithReason) {
      const state = await manager.read.verifyCredential([id]);
      if (state.status !== CREDENTIAL_STATUS.REVOKED) {
        await waitTx(
          ctx,
          manager.write.revokeCredential([id, plan.revokeWithReason], { account: issuerWallet.account }),
          `revokeCredential ${plan.clearanceCode} (reason ${plan.revokeWithReason})`,
        );
      }
    }

    const documentFile = path.join(outDir, `${index + 1}-${plan.key}-${credentialDocumentFileName(document)}`);
    const content = serializeCredentialDocument(document);
    fs.writeFileSync(documentFile, content);
    documents[plan.key] = { fileName: path.basename(documentFile), content };

    seeded.push({
      key: plan.key,
      scenario: plan.scenario,
      id,
      issuer: issuerAddress,
      holder: ctx.addresses.holder,
      clearanceCode: plan.clearanceCode,
      documentHash,
      documentFile: path.relative(REPO_ROOT, documentFile).replaceAll("\\", "/"),
      expiresAt,
    });
  }

  const summaryFile = path.join(outDir, "seed-summary.json");
  fs.writeFileSync(
    summaryFile,
    `${JSON.stringify({ network: ctx.networkName, chainId: ctx.chainId, actors: ctx.addresses, credentials: seeded }, null, 2)}\n`,
  );
  console.log(`  ✔ Demo documents and summary written to ${path.relative(REPO_ROOT, outDir)}/`);

  // Demo mode of the web app: personas, scenarios and sample certificates.
  saveWebDemoSeed(ctx.chainId, {
    network: ctx.networkName,
    chainId: ctx.chainId,
    seededAt: new Date().toISOString(),
    actors: ctx.addresses,
    issuers: ctx.issuers,
    credentials: seeded.map(({ documentFile: _file, ...credential }) => ({
      ...credential,
      document: documents[credential.key],
    })),
  });
  console.log(`  ✔ Demo fixtures written to ${path.relative(REPO_ROOT, WEB_DEMO_SEED_FILE)}`);
  return seeded;
}

export function printSeedSummary(seeded: SeededCredential[]): void {
  if (seeded.length === 0) return;
  console.log("\nDemo credentials:");
  for (const credential of seeded) {
    console.log(`  - [${credential.key}] ${credential.scenario}`);
    console.log(`      id:       ${credential.id}`);
    console.log(`      document: ${credential.documentFile}`);
  }
}
