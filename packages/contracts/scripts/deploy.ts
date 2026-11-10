/**
 * Deploys the SitePass federation:
 *   1. IssuerRegistry, which creates and admits the founding organizations
 *      (each one an Organization multisig contract with its admins and
 *      issuing members) in its constructor;
 *   2. SiteCredentialManager, bound to that registry;
 * then seeds demo credentials.
 *
 * There is no admin hand-over: the deployer never holds any role. From the
 * first block, only the organizations (through their own multisigs) can
 * change who may issue.
 *
 *   pnpm deploy:local          (needs `pnpm chain` running)
 *   pnpm deploy:base-sepolia
 *
 * Env flags: SEED_DEMO_DATA=false to skip seeding,
 *            GOVERNANCE_PROPOSAL_LIFETIME / GOVERNANCE_TIMELOCK_DELAY (seconds).
 */
import { getAddress } from "viem";

import { env, explorerAddress, getContext } from "./lib/context.ts";
import { type DeploymentRecord, WEB_DEPLOYMENTS_FILE, saveDeployment } from "./lib/deployments.ts";
import { printSeedSummary, seedDemoCredentials } from "./lib/seed.ts";
import { exportAbis } from "./export-abi.ts";

const ctx = await getContext();
const { viem, publicClient, addresses, organizations, governance } = ctx;

console.log(`\nDeploying SitePass on "${ctx.networkName}" (chain ${ctx.chainId})`);
console.log(`  deployer: ${addresses.deployer} (keeps no role)`);
console.log(
  `  governance: proposals live ${governance.proposalLifetime}s, timelock ${governance.timelockDelay}s, quorum > ${governance.initialQuorumBps / 100}%`,
);

const deployer = await viem.getWalletClient(addresses.deployer);
const startBlock = await publicClient.getBlockNumber();

const founders = organizations.map(({ name, domain, admins, threshold, members }) => ({
  name,
  domain,
  admins,
  threshold,
  members,
}));

const registry = await viem.deployContract(
  "IssuerRegistry",
  [BigInt(governance.proposalLifetime), BigInt(governance.timelockDelay), governance.initialQuorumBps, founders],
  { client: { wallet: deployer } },
);
console.log(`  ✔ IssuerRegistry         ${explorerAddress(ctx, registry.address)}`);

const orgAddresses = await registry.read.getOrganizationAccounts();
for (const [index, org] of organizations.entries()) {
  console.log(
    `  ✔ Organization ${org.name.padEnd(10)} ${explorerAddress(ctx, orgAddresses[index])}  (${org.threshold}-of-${org.admins.length} admins, ${org.members.length} member(s))`,
  );
}

const manager = await viem.deployContract("SiteCredentialManager", [registry.address], {
  client: { wallet: deployer },
});
console.log(`  ✔ SiteCredentialManager  ${explorerAddress(ctx, manager.address)}`);

const record: DeploymentRecord = {
  network: ctx.networkName,
  chainId: ctx.chainId,
  issuerRegistry: getAddress(registry.address),
  siteCredentialManager: getAddress(manager.address),
  deploymentBlock: Number(startBlock),
  deployer: addresses.deployer,
  governance,
  foundingOrganizations: organizations.map((org, index) => ({
    key: org.key,
    address: getAddress(orgAddresses[index]),
    name: org.name,
    domain: org.domain,
    admins: org.admins,
    threshold: Number(org.threshold),
    members: org.members,
  })),
  deployedAt: new Date().toISOString(),
};
saveDeployment(record);
exportAbis();
console.log(`  ✔ Addresses written to ${WEB_DEPLOYMENTS_FILE}`);

if (env("SEED_DEMO_DATA") !== "false") {
  console.log("\nSeeding demo credentials");
  printSeedSummary(await seedDemoCredentials(ctx, record));
}

console.log("\nPeople:");
for (const [role, address] of Object.entries(addresses)) {
  if (address) console.log(`  ${role.padEnd(9)} ${address}`);
}
console.log("\nDNS records to publish (one per organization, never changes when people change):");
for (const org of record.foundingOrganizations) {
  console.log(`  _sitepass.${org.domain}  TXT  "sitepass-issuer=${org.address}"`);
}
console.log("\nDone.");
