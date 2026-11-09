/**
 * Publishes the source code of the deployed contracts on the block explorer.
 * Uses Etherscan (Basescan) when ETHERSCAN_API_KEY is set, and always tries
 * Blockscout and Sourcify, which need no key.
 *
 *   pnpm verify:base-sepolia
 */
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

import { env, getContext } from "./lib/context.ts";
import { readDeployment } from "./lib/deployments.ts";

const ctx = await getContext();
const deployment = readDeployment(ctx.networkName);

const providers = [...(env("ETHERSCAN_API_KEY") ? (["etherscan"] as const) : []), "blockscout", "sourcify"] as const;

const targets = [
  { name: "IssuerRegistry", address: deployment.issuerRegistry, constructorArgs: [deployment.deployer] },
  {
    name: "SiteCredentialManager",
    address: deployment.siteCredentialManager,
    constructorArgs: [deployment.issuerRegistry],
  },
];

for (const target of targets) {
  for (const provider of providers) {
    try {
      console.log(`\nVerifying ${target.name} (${target.address}) on ${provider}...`);
      await verifyContract(
        {
          address: target.address,
          constructorArgs: target.constructorArgs,
          contract: `contracts/${target.name}.sol:${target.name}`,
          provider,
        },
        hre,
      );
    } catch (error) {
      console.log(`  ! ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
