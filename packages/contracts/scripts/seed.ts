/**
 * Re-runs the demo seeding against an existing deployment: issues a fresh set
 * of demo credentials. (The organizations themselves are created and admitted
 * at deployment; later changes go through governance.)
 *
 *   pnpm seed:local
 *   pnpm seed:base-sepolia
 */
import { getContext } from "./lib/context.ts";
import { readDeployment } from "./lib/deployments.ts";
import { printSeedSummary, seedDemoCredentials } from "./lib/seed.ts";

const ctx = await getContext();
const deployment = readDeployment(ctx.networkName);

console.log(`\nSeeding SitePass demo data on "${ctx.networkName}" (chain ${ctx.chainId})`);
printSeedSummary(await seedDemoCredentials(ctx, deployment));
