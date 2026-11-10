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
import { type Address, type Hex, formatEther, isAddressEqual, parseEther, zeroAddress } from "viem";

import { REPO_ROOT, type ScriptContext, env, waitTx } from "./context.ts";
import { type DeploymentRecord, WEB_DEMO_SEED_FILE, saveWebDemoSeed } from "./deployments.ts";

/** Off-chain documents are personal data: written locally, git-ignored. */
const DEMO_DIR = path.join(REPO_ROOT, "demo");

/** Minimum balance a demo person should have on a public network. */
const MIN_PERSON_BALANCE = parseEther("0.0005");
const PERSON_TOP_UP = parseEther("0.001");

interface SeedCredentialPlan {
  key: string;
  /** Trainer (issuing member) of organization A or B who signs the credential. */
  issuer: "a" | "b";
  clearanceCode: string;
  validityDays: number;
  /** Overrides `validityDays` with a short lifetime in minutes (expiry demo). */
  validityMinutes?: number;
  revokeWithReason?: number;
  scenario: string;
}

const DEMO_HOLDER_IDENTITY = {
  firstName: "Worker",
  lastName: "Test",
  birthDate: "1990-01-01",
  employer: "Demo Construction",
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
      scenario: "VALID - to be revoked live (by a colleague of the signer) during the demo",
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
      scenario: "REVOKED by the second organization (MEDICAL_UNFIT)",
    },
  ];
}

/**
 * On a public network, gives every demo person a little gas so that they can
 * sign issuances and governance proposals from MetaMask during the demo.
 */
async function fundDemoPeople(ctx: ScriptContext): Promise<void> {
  if (ctx.isLocal) return;
  const { deployer: _deployer, holder: _holder, attacker: _attacker, ...people } = ctx.addresses;
  const deployer = await ctx.viem.getWalletClient(ctx.addresses.deployer);
  for (const [role, address] of Object.entries(people)) {
    if (!address) continue;
    const balance = await ctx.publicClient.getBalance({ address });
    if (balance >= MIN_PERSON_BALANCE) continue;
    console.log(`  • Topping up ${role} ${address} (balance ${formatEther(balance)} ETH) with ${formatEther(PERSON_TOP_UP)} ETH`);
    const hash = await deployer.sendTransaction({ to: address, value: PERSON_TOP_UP });
    await ctx.publicClient.waitForTransactionReceipt({ hash });
  }
}

export interface SeededCredential {
  key: string;
  scenario: string;
  id: Hex;
  /** Issuing organization (Organization contract). */
  issuer: Address;
  /** Member (person) who signed the issuance. */
  signer: Address;
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

  await fundDemoPeople(ctx);

  const seeded: SeededCredential[] = [];
  const documents: Record<string, { fileName: string; content: string }> = {};
  for (const [index, plan] of buildPlan().entries()) {
    const signer = plan.issuer === "a" ? ctx.addresses.issuerA : ctx.addresses.issuerB;
    const org = (await registry.read.issuingOrganizationOf([signer])) as Address;
    if (isAddressEqual(org, zeroAddress)) {
      console.log(`  ! Skipping "${plan.key}": ${signer} is not a member of an active organization.`);
      continue;
    }
    const signerWallet = await ctx.viem.getWalletClient(signer);
    const orgInfo = await registry.read.getOrganization([org]);

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
      issuer: { address: org, name: orgInfo.name, domain: orgInfo.domain, signer },
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
    const id = (await manager.read.computeCredentialId([org, documentHash])) as Hex;

    const existing = await manager.read.verifyCredential([id]);
    if (existing.exists) {
      console.log(`  • "${plan.key}" already issued (${id})`);
    } else {
      await waitTx(
        ctx,
        manager.write.issueCredential(
          [ctx.addresses.holder, encodeCredentialType(plan.clearanceCode), documentHash, BigInt(expiresAt)],
          { account: signerWallet.account },
        ),
        `issueCredential ${plan.clearanceCode} for ${orgInfo.name}, signed by ${signer}`,
      );
    }

    if (plan.revokeWithReason) {
      const state = await manager.read.verifyCredential([id]);
      if (state.status !== CREDENTIAL_STATUS.REVOKED) {
        await waitTx(
          ctx,
          manager.write.revokeCredential([id, plan.revokeWithReason], { account: signerWallet.account }),
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
      issuer: org,
      signer,
      holder: ctx.addresses.holder,
      clearanceCode: plan.clearanceCode,
      documentHash,
      documentFile: path.relative(REPO_ROOT, documentFile).replaceAll("\\", "/"),
      expiresAt,
    });
  }

  const summaryFile = path.join(outDir, "seed-summary.json");
  const summary = {
    network: ctx.networkName,
    chainId: ctx.chainId,
    actors: ctx.addresses,
    organizations: deployment.foundingOrganizations,
    credentials: seeded,
  };
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`  ✔ Demo documents and summary written to ${path.relative(REPO_ROOT, outDir)}/`);

  // Demo mode of the web app: personas, scenarios and sample certificates.
  saveWebDemoSeed(ctx.chainId, {
    network: ctx.networkName,
    chainId: ctx.chainId,
    seededAt: new Date().toISOString(),
    actors: ctx.addresses,
    organizations: deployment.foundingOrganizations,
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
