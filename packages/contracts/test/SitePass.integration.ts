/**
 * End-to-end integration test: the full lifecycle exactly as the frontend and
 * scripts drive it (off-chain document -> SHA-256 -> issuance -> wallet-less
 * verification -> EIP-712 proof of control -> revocation), plus the readable
 * revert reasons expected during the defense.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREDENTIAL_STATUS,
  buildCredentialDocument,
  computeCredentialId,
  createProofChallenge,
  decodeCredentialType,
  encodeCredentialType,
  hashCredentialDocument,
  proofTypedData,
  serializeCredentialDocument,
  sha256Hex,
  tryParseCredentialDocument,
  verifyProofSignature,
} from "@sitepass/shared";
import { network } from "hardhat";
import { type Hex, getAddress } from "viem";

const SAFETY_BREACH = 1;

describe("SitePass end-to-end", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [admin, apave, dekra, worker, attacker] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  async function deploySitePass() {
    const registry = await viem.deployContract("IssuerRegistry", [admin.account.address]);
    const manager = await viem.deployContract("SiteCredentialManager", [registry.address]);
    await registry.write.addIssuer([apave.account.address, "Apave", "apave.com"]);
    await registry.write.addIssuer([dekra.account.address, "Dekra", "dekra.com"]);
    return { registry, manager };
  }

  async function makeDocument(managerAddress: Hex) {
    const now = new Date(Number(await networkHelpers.time.latest()) * 1000);
    const document = buildCredentialDocument({
      chainId,
      manager: managerAddress,
      issuer: { address: apave.account.address, name: "Apave", domain: "apave.com" },
      holder: {
        address: worker.account.address,
        firstName: "Camille",
        lastName: "Martin",
        birthDate: "1991-04-12",
        employer: "ACME Construction",
      },
      clearanceCode: "NUC-PR1-CC",
      training: { sessionReference: "S-001", location: "Lyon", completedOn: "2026-10-01", result: "Passed" },
      validFrom: now,
      validUntil: new Date(now.getTime() + 365 * 86_400_000),
    });
    return { document, documentHash: await hashCredentialDocument(document) };
  }

  async function issueDemoCredential() {
    const contracts = await networkHelpers.loadFixture(deploySitePass);
    const { document, documentHash } = await makeDocument(contracts.manager.address);
    const expiresAt = BigInt(Math.floor(new Date(document.validUntil!).getTime() / 1000));
    const credentialType = encodeCredentialType("NUC-PR1-CC");

    const hash = await contracts.manager.write.issueCredential(
      [worker.account.address, credentialType, documentHash, expiresAt],
      { account: apave.account },
    );
    await publicClient.waitForTransactionReceipt({ hash });
    const [event] = await contracts.manager.getEvents.CredentialIssued();
    return { ...contracts, document, documentHash, expiresAt, id: event.args.id as Hex };
  }

  it("anchors only the SHA-256 of the off-chain document (no personal data on-chain)", async function () {
    const { manager, document, documentHash, id } = await issueDemoCredential();

    // The verifier recomputes the hash from the raw file bytes.
    const fileBytes = new TextEncoder().encode(serializeCredentialDocument(document));
    assert.equal(await sha256Hex(fileBytes), documentHash);
    assert.ok(tryParseCredentialDocument(fileBytes));

    // The id can be recomputed off-chain from the document alone.
    assert.equal(
      id,
      computeCredentialId({ chainId, manager: manager.address, issuer: apave.account.address, documentHash }),
    );
    assert.deepEqual(await manager.read.getCredentialsByDocumentHash([documentHash]), [id]);

    // Nothing personal leaks into the issuance transaction or its logs.
    const [log] = await manager.getEvents.CredentialIssued();
    const tx = await publicClient.getTransaction({ hash: log.transactionHash });
    const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash });
    const onChainBytes = (tx.input + receipt.logs.map((l) => l.data + l.topics.join("")).join("")).toLowerCase();
    for (const secret of ["Camille", "Martin", "1991-04-12", "ACME"]) {
      assert.ok(!onChainBytes.includes(Buffer.from(secret).toString("hex")), `"${secret}" leaked on-chain`);
    }
    assert.ok(!onChainBytes.includes(document.salt.slice(2).toLowerCase()), "salt leaked on-chain");
  });

  it("lets anyone verify with a plain eth_call, without a wallet", async function () {
    const { manager, documentHash, expiresAt, id } = await issueDemoCredential();

    const view = await publicClient.readContract({
      address: manager.address,
      abi: manager.abi,
      functionName: "verifyCredential",
      args: [id],
    });
    assert.equal(view.exists, true);
    assert.equal(view.isValid, true);
    assert.equal(view.status, CREDENTIAL_STATUS.VALID);
    assert.equal(view.issuer, getAddress(apave.account.address));
    assert.equal(view.issuerName, "Apave");
    assert.equal(view.issuerDomain, "apave.com");
    assert.equal(view.holder, getAddress(worker.account.address));
    assert.equal(view.documentHash, documentHash);
    assert.equal(view.expiresAt, expiresAt);
    assert.equal(decodeCredentialType(view.credentialType), "NUC-PR1-CC");
    assert.deepEqual(await manager.read.getCredentialsByHolder([worker.account.address]), [id]);
  });

  it("accepts an EIP-712 proof of control from the holder and rejects anyone else", async function () {
    const { manager, id } = await issueDemoCredential();
    const challenge = createProofChallenge({
      chainId,
      manager: manager.address,
      credentialId: id,
      holder: worker.account.address,
      site: "Gate 3",
    });

    const signature = await worker.signTypedData(proofTypedData(challenge));
    assert.deepEqual(await verifyProofSignature(challenge, signature), {
      ok: true,
      signer: getAddress(worker.account.address),
    });

    const forged = await attacker.signTypedData(proofTypedData(challenge));
    const rejected = await verifyProofSignature(challenge, forged);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.ok === false && rejected.reason, "WRONG_SIGNER");

    const stale = await verifyProofSignature(challenge, signature, challenge.expiresAt + 1);
    assert.equal(stale.ok === false && stale.reason, "EXPIRED");
  });

  it("records revocation by the original issuer with reason, date and event", async function () {
    const { manager, id } = await issueDemoCredential();

    await viem.assertions.emitWithArgs(
      manager.write.revokeCredential([id, SAFETY_BREACH], { account: apave.account }),
      manager,
      "CredentialRevoked",
      [id, getAddress(apave.account.address), getAddress(worker.account.address), SAFETY_BREACH, (t: bigint) => t > 0n],
    );

    const view = await manager.read.verifyCredential([id]);
    assert.equal(view.status, CREDENTIAL_STATUS.REVOKED);
    assert.equal(view.revocationReason, SAFETY_BREACH);
    assert.ok(view.revokedAt > 0n);
    assert.equal(view.exists, true);
  });

  it("reverts with readable custom errors for the three defense failure cases", async function () {
    const { manager, id } = await issueDemoCredential();

    await viem.assertions.revertWithCustomErrorWithArgs(
      manager.write.issueCredential(
        [worker.account.address, encodeCredentialType("ELEC-B2V"), await sha256Hex("forged"), 0n],
        { account: attacker.account },
      ),
      manager,
      "NotAuthorizedIssuer",
      [getAddress(attacker.account.address)],
    );

    await viem.assertions.revertWithCustomErrorWithArgs(
      manager.write.revokeCredential([id, SAFETY_BREACH], { account: dekra.account }),
      manager,
      "NotCredentialIssuer",
      [id, getAddress(dekra.account.address)],
    );

    await viem.assertions.revertWithCustomErrorWithArgs(
      manager.read.transferCredential([id, attacker.account.address], { account: worker.account.address }),
      manager,
      "CredentialNonTransferable",
      [id],
    );
  });

  it("reports expiration based on block time", async function () {
    const { manager, expiresAt, id } = await issueDemoCredential();

    await networkHelpers.time.increaseTo(expiresAt - 1n);
    assert.equal((await manager.read.verifyCredential([id])).status, CREDENTIAL_STATUS.VALID);

    await networkHelpers.time.increaseTo(expiresAt);
    const view = await manager.read.verifyCredential([id]);
    assert.equal(view.status, CREDENTIAL_STATUS.EXPIRED);
    assert.equal(view.isExpired, true);
    assert.equal(view.isValid, false);
  });
});
