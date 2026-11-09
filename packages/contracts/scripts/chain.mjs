/**
 * Starts the local dev chain (`hardhat node --network devnode`) and hides the
 * "Mined empty block" lines produced every 2 seconds by interval mining, so
 * that transactions and RPC errors stay readable.
 *
 *   pnpm chain
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn("hardhat", ["node", "--network", "devnode", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

const NOISE = /^\s*Mined empty block/;

for (const [stream, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  readline.createInterface({ input: stream }).on("line", (line) => {
    if (!NOISE.test(line)) target.write(`${line}\n`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
