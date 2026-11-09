/**
 * Demonstrates the three mandatory failure cases and prints the decoded revert
 * reasons. Calls are simulated (eth_call with `from` set), exactly what a
 * wallet does before signing, so no gas is spent and no key is needed.
 *
 *   pnpm demo:failures:local
 *   pnpm demo:failures:base-sepolia
 */
import { encodeCredentialType, sha256Hex } from "@sitepass/shared";
import { type Address, BaseError, ContractFunctionRevertedError, type Hex } from "viem";

import { getContext } from "./lib/context.ts";
import { readDeployment } from "./lib/deployments.ts";

const ctx = await getContext();
const deployment = readDeployment(ctx.networkName);
const manager = await ctx.viem.getContractAt("SiteCredentialManager", deployment.siteCredentialManager);
const { issuerA, issuerB, holder, attacker } = ctx.addresses;

function describeRevert(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      const args = (revert.data.args ?? []).map(String).join(", ");
      return `${revert.data.errorName}(${args})`;
    }
    return error.shortMessage;
  }
  return String(error);
}

async function expectRevert(title: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    console.log(`  ✘ ${title}\n      UNEXPECTED SUCCESS`);
    return false;
  } catch (error) {
    console.log(`  ✔ ${title}\n      reverted with ${describeRevert(error)}`);
    return true;
  }
}

// Pick a credential issued by issuer A to the holder (seeded by the deploy script).
const holderIds = (await manager.read.getCredentialsByHolder([holder])) as Hex[];
const views = holderIds.length > 0 ? await manager.read.verifyCredentials([holderIds]) : [];
const target = views.find((view) => view.issuer.toLowerCase() === issuerA.toLowerCase());
if (!target) throw new Error("No credential from issuer A found for the demo holder. Run the seed script first.");

console.log(`\nFailure scenarios on "${ctx.networkName}" against credential ${target.id}\n`);

const results = [
  await expectRevert(`1. Non-issuer ${attacker} tries to issue a credential`, async () =>
    manager.simulate.issueCredential(
      [holder, encodeCredentialType("NUC-PR1-CC"), await sha256Hex("forged certificate"), 0n],
      { account: attacker as Address },
    ),
  ),
  await expectRevert(`2. Other issuer ${issuerB} tries to revoke issuer A's credential`, () =>
    manager.simulate.revokeCredential([target.id, 1], { account: issuerB as Address }),
  ),
  await expectRevert(`3. Holder ${holder} tries to transfer the credential`, () =>
    manager.read.transferCredential([target.id, attacker], { account: holder as Address }),
  ),
  await expectRevert("4. Issuer A revokes with an invalid reason code (0)", () =>
    manager.simulate.revokeCredential([target.id, 0], { account: issuerA as Address }),
  ),
];

console.log(`\n${results.filter(Boolean).length}/${results.length} failure cases reverted as expected.`);
if (results.some((ok) => !ok)) process.exitCode = 1;
