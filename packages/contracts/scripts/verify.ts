/**
 * Publishes the source code of the deployed contracts on the block explorer:
 * the registry, the manager and every founding Organization contract.
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

const { governance, foundingOrganizations } = deployment;
const targets = [
  {
    name: "IssuerRegistry",
    address: deployment.issuerRegistry,
    constructorArgs: [
      BigInt(governance.proposalLifetime),
      BigInt(governance.timelockDelay),
      governance.initialQuorumBps,
      foundingOrganizations.map(({ name, domain, admins, threshold, members }) => ({
        name,
        domain,
        admins,
        threshold: BigInt(threshold),
        members,
      })),
    ],
  },
  ...foundingOrganizations.map((org) => ({
    name: "Organization",
    address: org.address,
    constructorArgs: [org.admins, BigInt(org.threshold), org.members],
  })),
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
