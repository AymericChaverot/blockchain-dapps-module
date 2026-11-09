/**
 * Re-runs the demo seeding against an existing deployment: registers missing
 * demo issuers and issues a fresh set of demo credentials.
 *
 *   pnpm seed:local
 *   pnpm seed:base-sepolia
 */
import { getContext } from "./lib/context.ts";
import { readDeployment } from "./lib/deployments.ts";
import { printSeedSummary, registerDemoIssuers, seedDemoCredentials } from "./lib/seed.ts";

const ctx = await getContext();
const deployment = readDeployment(ctx.networkName);

console.log(`\nSeeding SitePass demo data on "${ctx.networkName}" (chain ${ctx.chainId})`);
console.log("\nRegistering demo issuers");
await registerDemoIssuers(ctx, deployment);
console.log("\nSeeding demo credentials");
printSeedSummary(await seedDemoCredentials(ctx, deployment));
