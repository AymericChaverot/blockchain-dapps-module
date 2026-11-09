import path from "node:path";
import { fileURLToPath } from "node:url";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";
import { configVariable, defineConfig } from "hardhat/config";

// Every setting of the monorepo lives in a single `.env` file at the repo root.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

/**
 * Base Sepolia signers. Only the deployer is mandatory for deployment; the two demo
 * issuer keys are needed to seed demo credentials.
 */
const baseSepoliaAccounts = [
  configVariable("DEPLOYER_PRIVATE_KEY"),
  ...["ISSUER_A_PRIVATE_KEY", "ISSUER_B_PRIVATE_KEY"]
    .filter((name) => (process.env[name] ?? "").trim() !== "")
    .map((name) => configVariable(name)),
];

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
        },
      },
    },
  },
  networks: {
    // In-process simulated chain used by `hardhat test`.
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // Chain served by `pnpm chain` (hardhat node --network devnode). Interval
    // mining keeps block.timestamp close to wall-clock time, so free `view`
    // calls see credentials expire even when no transaction is sent.
    devnode: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      mining: { auto: true, interval: 2000 },
    },
    // JSON-RPC client pointing at the dev chain above.
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: baseSepoliaAccounts,
    },
  },
  verify: {
    etherscan: {
      // Etherscan API v2 key (one key works for every chain, Base Sepolia included).
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
      enabled: (process.env.ETHERSCAN_API_KEY ?? "") !== "",
    },
  },
});
