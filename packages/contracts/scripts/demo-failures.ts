/**
 * Demonstrates the mandatory failure cases (plus the governance ones) and
 * prints the decoded revert reasons. Calls are simulated (eth_call with
 * `from` set), exactly what a wallet does before signing, so no gas is spent
 * and no key is needed.
 *
 *   pnpm demo:failures:local
 *   pnpm demo:failures:base-sepolia
 */
import { encodeCredentialType, sha256Hex } from "@sitepass/shared";
import { type Address, BaseError, ContractFunctionRevertedError, type Hex, isAddressEqual } from "viem";

import { getContext } from "./lib/context.ts";
import { readDeployment } from "./lib/deployments.ts";

const ctx = await getContext();
const deployment = readDeployment(ctx.networkName);
const manager = await ctx.viem.getContractAt("SiteCredentialManager", deployment.siteCredentialManager);
const registry = await ctx.viem.getContractAt("IssuerRegistry", deployment.issuerRegistry);
const { issuerA, issuerB, adminA1, holder, attacker, deployer } = ctx.addresses;
const orgA = deployment.foundingOrganizations.find((org) => org.key === "a");
if (!orgA) throw new Error("Founding organization A not found in the deployment record.");

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

// Pick a credential issued by organization A to the holder (seeded by the deploy script).
const holderIds = (await manager.read.getCredentialsByHolder([holder])) as Hex[];
const views = holderIds.length > 0 ? await manager.read.verifyCredentials([holderIds]) : [];
const target = views.find((view) => isAddressEqual(view.issuer, orgA.address));
if (!target) throw new Error("No credential from organization A found for the demo holder. Run the seed script first.");

console.log(`\nFailure scenarios on "${ctx.networkName}" against credential ${target.id}\n`);

const results = [
  await expectRevert(`1. Wallet with no role ${attacker} tries to issue a credential`, async () =>
    manager.simulate.issueCredential(
      [holder, encodeCredentialType("NUC-PR1-CC"), await sha256Hex("forged certificate"), 0n],
      { account: attacker as Address },
    ),
  ),
  await expectRevert(`2. Member of organization B ${issuerB} tries to revoke organization A's credential`, () =>
    manager.simulate.revokeCredential([target.id, 1], { account: issuerB as Address }),
  ),
  await expectRevert(`3. Holder ${holder} tries to transfer the credential`, () =>
    manager.read.transferCredential([target.id, attacker], { account: holder as Address }),
  ),
  await expectRevert(`4. Member of organization A ${issuerA} revokes with an invalid reason code (0)`, () =>
    manager.simulate.revokeCredential([target.id, 0], { account: issuerA as Address }),
  ),
  await expectRevert(`5. Admin of organization A ${adminA1} (not a member) tries to issue`, async () =>
    manager.simulate.issueCredential(
      [holder, encodeCredentialType("NUC-PR1-CC"), await sha256Hex("admin certificate"), 0n],
      { account: adminA1 as Address },
    ),
  ),
  await expectRevert(`6. The deployer ${deployer} tries to suspend organization A (no admin exists)`, () =>
    registry.simulate.proposeSuspension([orgA.address], { account: deployer as Address }),
  ),
  await expectRevert(`7. Admin ${adminA1} votes alone, with their own wallet, instead of through the org multisig`, () =>
    registry.simulate.approve([0n], { account: adminA1 as Address }),
  ),
];

console.log(`\n${results.filter(Boolean).length}/${results.length} failure cases reverted as expected.`);
if (results.some((ok) => !ok)) process.exitCode = 1;
