/**
 * Creates the root `.env` from `.env.example` and, with --generate-keys, fills
 * the empty Base Sepolia demo wallets with freshly generated keys.
 *
 *   pnpm env:init                # create .env if missing, print the actors
 *   pnpm env:keys                # also generate deployer / issuers / holder keys
 *
 * Run with plain Node (>= 22.18, native TypeScript type stripping).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENV_FILE = path.join(ROOT, ".env");
const EXAMPLE_FILE = path.join(ROOT, ".env.example");
const KEY_VARS = ["DEPLOYER_PRIVATE_KEY", "ISSUER_A_PRIVATE_KEY", "ISSUER_B_PRIVATE_KEY", "HOLDER_PRIVATE_KEY"] as const;

function readVar(content: string, name: string): string {
  const match = content.match(new RegExp(`^${name}=(.*)$`, "m"));
  return (match?.[1] ?? "").trim().replace(/^"|"$/g, "");
}

function writeVar(content: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

if (!fs.existsSync(ENV_FILE)) {
  fs.copyFileSync(EXAMPLE_FILE, ENV_FILE);
  console.log("✔ Created .env from .env.example");
} else {
  console.log("• .env already exists, keeping it");
}

let content = fs.readFileSync(ENV_FILE, "utf8");

if (process.argv.includes("--generate-keys")) {
  for (const name of KEY_VARS) {
    if (readVar(content, name)) continue;
    content = writeVar(content, name, generatePrivateKey());
    console.log(`✔ Generated ${name}`);
  }
  const holderKey = readVar(content, "HOLDER_PRIVATE_KEY");
  if (holderKey && !readVar(content, "HOLDER_ADDRESS")) {
    content = writeVar(content, "HOLDER_ADDRESS", privateKeyToAccount(holderKey as `0x${string}`).address);
    console.log("✔ Derived HOLDER_ADDRESS from HOLDER_PRIVATE_KEY");
  }
  fs.writeFileSync(ENV_FILE, content);
}

console.log("\nBase Sepolia actors configured in .env:");
for (const name of KEY_VARS) {
  const key = readVar(content, name);
  const role = name.replace("_PRIVATE_KEY", "").toLowerCase().padEnd(9);
  console.log(`  ${role} ${key ? privateKeyToAccount(key as `0x${string}`).address : "(not set)"}`);
}
const deployerKey = readVar(content, "DEPLOYER_PRIVATE_KEY");
if (deployerKey) {
  console.log(
    `\n→ Fund the deployer with Base Sepolia ETH (e.g. https://www.alchemy.com/faucets/base-sepolia):\n  ${privateKeyToAccount(deployerKey as `0x${string}`).address}`,
  );
  console.log("  The deploy script tops up both issuers automatically. Then run: pnpm deploy:base-sepolia");
}
