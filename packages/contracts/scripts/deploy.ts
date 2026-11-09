/**
 * Deploys IssuerRegistry + SiteCredentialManager, registers the demo issuers,
 * seeds demo credentials and finally hands the registry over to the admin
 * (Safe multisig) configured in REGISTRY_ADMIN_ADDRESS.
 *
 *   pnpm deploy:local          (needs `pnpm chain` running)
 *   pnpm deploy:base-sepolia
 *
 * Env flags: SEED_DEMO_DATA=false to skip seeding.
 */
import { getAddress, isAddressEqual } from "viem";

import { env, explorerAddress, getContext, waitTx } from "./lib/context.ts";
import { type DeploymentRecord, WEB_DEPLOYMENTS_FILE, saveDeployment } from "./lib/deployments.ts";
import { printSeedSummary, registerDemoIssuers, seedDemoCredentials } from "./lib/seed.ts";
import { exportAbis } from "./export-abi.ts";

const ctx = await getContext();
const { viem, publicClient, addresses } = ctx;

console.log(`\nDeploying SitePass on "${ctx.networkName}" (chain ${ctx.chainId})`);
console.log(`  deployer: ${addresses.deployer}`);

const deployer = await viem.getWalletClient(addresses.deployer);
const startBlock = await publicClient.getBlockNumber();

// The deployer is the temporary admin so that it can register the demo
// issuers; ownership is handed over to the Safe right after.
const registry = await viem.deployContract("IssuerRegistry", [addresses.deployer], { client: { wallet: deployer } });
console.log(`  ✔ IssuerRegistry         ${explorerAddress(ctx, registry.address)}`);

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
  registryAdmin: addresses.deployer,
  deployedAt: new Date().toISOString(),
};
saveDeployment(record);
exportAbis();
console.log(`  ✔ Addresses written to ${WEB_DEPLOYMENTS_FILE}`);

console.log("\nRegistering demo issuers");
await registerDemoIssuers(ctx, record);

if (env("SEED_DEMO_DATA") !== "false") {
  console.log("\nSeeding demo credentials");
  printSeedSummary(await seedDemoCredentials(ctx, record));
}

if (ctx.registryAdmin && !isAddressEqual(ctx.registryAdmin, addresses.deployer)) {
  console.log("\nHanding the registry over to the admin multisig");
  await waitTx(
    ctx,
    registry.write.transferOwnership([ctx.registryAdmin], { account: deployer.account }),
    `transferOwnership → ${ctx.registryAdmin} (pending until accepted)`,
  );
  console.log("  → The Safe must now call acceptOwnership() on the registry (Safe Transaction Builder).");
} else {
  console.log("\n! REGISTRY_ADMIN_ADDRESS not set: the deployer remains the registry admin.");
}

console.log("\nActors:");
for (const [role, address] of Object.entries(addresses)) console.log(`  ${role.padEnd(9)} ${address}`);
console.log("\nDone.");
