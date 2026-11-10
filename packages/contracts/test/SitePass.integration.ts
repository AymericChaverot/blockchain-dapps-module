/**
 * End-to-end integration test: the full lifecycle exactly as the frontend and
 * scripts drive it (off-chain document -> SHA-256 -> issuance -> wallet-less
 * verification -> EIP-712 proof of control -> revocation), the readable
 * revert reasons expected during the defense, and the self-governed
 * federation (organizations vote through their own multisigs; no admin).
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
import { type Address, type Hex, getAddress, zeroAddress } from "viem";

const SAFETY_BREACH = 1;
/** Organization.Action.APPROVE_FEDERATION_PROPOSAL */
const APPROVE_FEDERATION_PROPOSAL = 5;

describe("SitePass end-to-end", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, issuerA, issuerB, worker, attacker, adminA1, adminA2, adminB, issuerA2, adminC] =
    await viem.getWalletClients();
  const chainId = await publicClient.getChainId();
  const LIFETIME = 7n * 86_400n;
  const DELAY = 60n;

  async function deploySitePass() {
    const registry = await viem.deployContract("IssuerRegistry", [
      LIFETIME,
      DELAY,
      5_000,
      [
        {
          name: "Issuer A",
          domain: "issuer-a.example",
          admins: [adminA1.account.address, adminA2.account.address],
          threshold: 2n,
          members: [issuerA.account.address, issuerA2.account.address],
        },
        {
          name: "Issuer B",
          domain: "issuer-b.example",
          admins: [adminB.account.address],
          threshold: 1n,
          members: [issuerB.account.address],
        },
      ],
    ]);
    const [orgAAddress, orgBAddress] = await registry.read.getOrganizationAccounts();
    const orgA = await viem.getContractAt("Organization", orgAAddress);
    const orgB = await viem.getContractAt("Organization", orgBAddress);
    const manager = await viem.deployContract("SiteCredentialManager", [registry.address]);
    return { registry, manager, orgA, orgB };
  }

  async function wait(hash: Promise<Hex>) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await hash });
    assert.equal(receipt.status, "success");
  }

  async function makeDocument(managerAddress: Address, orgAddress: Address) {
    const now = new Date(Number(await networkHelpers.time.latest()) * 1000);
    const document = buildCredentialDocument({
      chainId,
      manager: managerAddress,
      issuer: {
        address: orgAddress,
        name: "Issuer A",
        domain: "issuer-a.example",
        signer: issuerA.account.address,
      },
      holder: {
        address: worker.account.address,
        firstName: "Worker",
        lastName: "Test",
        birthDate: "1990-01-01",
        employer: "Demo Construction",
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
    const { document, documentHash } = await makeDocument(contracts.manager.address, contracts.orgA.address);
    const expiresAt = BigInt(Math.floor(new Date(document.validUntil!).getTime() / 1000));
    const credentialType = encodeCredentialType("NUC-PR1-CC");

    await wait(
      contracts.manager.write.issueCredential([worker.account.address, credentialType, documentHash, expiresAt], {
        account: issuerA.account,
      }),
    );
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
      computeCredentialId({ chainId, manager: manager.address, issuer: document.issuer.address, documentHash }),
    );
    assert.deepEqual(await manager.read.getCredentialsByDocumentHash([documentHash]), [id]);

    // Nothing personal leaks into the issuance transaction or its logs.
    const [log] = await manager.getEvents.CredentialIssued();
    const tx = await publicClient.getTransaction({ hash: log.transactionHash });
    const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash });
    const onChainBytes = (tx.input + receipt.logs.map((l) => l.data + l.topics.join("")).join("")).toLowerCase();
    for (const secret of ["Worker", "Test", "1990-01-01", "Demo Construction"]) {
      assert.ok(!onChainBytes.includes(Buffer.from(secret).toString("hex")), `"${secret}" leaked on-chain`);
    }
    assert.ok(!onChainBytes.includes(document.salt.slice(2).toLowerCase()), "salt leaked on-chain");
  });

  it("lets anyone verify with a plain eth_call, without a wallet", async function () {
    const { manager, orgA, documentHash, expiresAt, id } = await issueDemoCredential();

    const view = await publicClient.readContract({
      address: manager.address,
      abi: manager.abi,
      functionName: "verifyCredential",
      args: [id],
    });
    assert.equal(view.exists, true);
    assert.equal(view.isValid, true);
    assert.equal(view.status, CREDENTIAL_STATUS.VALID);
    assert.equal(view.issuer, getAddress(orgA.address), "issued by the organization");
    assert.equal(view.signer, getAddress(issuerA.account.address), "signed by the person");
    assert.equal(view.issuerName, "Issuer A");
    assert.equal(view.issuerDomain, "issuer-a.example");
    assert.equal(view.holder, getAddress(worker.account.address));
    assert.equal(view.documentHash, documentHash);
    assert.equal(view.expiresAt, expiresAt);
    assert.equal(decodeCredentialType(view.credentialType), "NUC-PR1-CC");
    assert.deepEqual(await manager.read.getCredentialsByHolder([worker.account.address]), [id]);
    assert.deepEqual(await manager.read.getCredentialsBySigner([issuerA.account.address]), [id]);
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

  it("records revocation by any member of the issuing organization with reason, date and event", async function () {
    const { manager, orgA, id } = await issueDemoCredential();

    // Signed by issuerA, revoked by their colleague issuerA2.
    await viem.assertions.emitWithArgs(
      manager.write.revokeCredential([id, SAFETY_BREACH], { account: issuerA2.account }),
      manager,
      "CredentialRevoked",
      [
        id,
        getAddress(orgA.address),
        getAddress(worker.account.address),
        getAddress(issuerA2.account.address),
        SAFETY_BREACH,
        (t: bigint) => t > 0n,
      ],
    );

    const view = await manager.read.verifyCredential([id]);
    assert.equal(view.status, CREDENTIAL_STATUS.REVOKED);
    assert.equal(view.revocationReason, SAFETY_BREACH);
    assert.ok(view.revokedAt > 0n);
    assert.equal(view.revokedBy, getAddress(issuerA2.account.address));
    assert.equal(view.signer, getAddress(issuerA.account.address));
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
      manager.write.revokeCredential([id, SAFETY_BREACH], { account: issuerB.account }),
      manager,
      "NotCredentialIssuer",
      [id, getAddress(issuerB.account.address)],
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

  it("is governed by the organizations themselves: suspension by vote, admission after a timelock", async function () {
    const { registry, manager, orgA, orgB, id } = await issueDemoCredential();

    // There is no admin: the deployer has no power at all.
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.proposeSuspension([orgA.address], { account: deployer.account }),
      registry,
      "NotAuthorizedProposer",
      [getAddress(deployer.account.address)],
    );

    // A suspends B. B cannot vote on its own suspension, so A is the only
    // eligible voter, and A votes through its 2-of-2 multisig.
    await wait(registry.write.proposeSuspension([orgB.address], { account: adminA1.account }));
    await wait(
      orgA.write.propose([APPROVE_FEDERATION_PROPOSAL, zeroAddress, 0n], { account: adminA1.account }),
    );
    assert.equal(await registry.read.isActiveOrganization([orgB.address]), true, "one admin of A is not enough");
    await wait(orgA.write.approve([0n], { account: adminA2.account }));
    assert.equal(await registry.read.isActiveOrganization([orgB.address]), false, "suspension runs immediately");

    // Members of a suspended organization can no longer issue.
    await viem.assertions.revertWithCustomErrorWithArgs(
      manager.write.issueCredential(
        [worker.account.address, encodeCredentialType("ELEC-B2V"), await sha256Hex("after suspension"), 0n],
        { account: issuerB.account },
      ),
      manager,
      "NotAuthorizedIssuer",
      [getAddress(issuerB.account.address)],
    );

    // A candidate organization C applies; A (the only active voter) admits it after the timelock.
    await wait(
      registry.write.createOrganization(
        ["Issuer C", "issuer-c.example", [adminC.account.address], 1n, [adminC.account.address]],
        { account: adminC.account },
      ),
    );
    const orgC = (await registry.read.getOrganizationAccounts())[2];
    await wait(registry.write.proposeAdmission([orgC], { account: adminC.account }));
    await wait(
      orgA.write.propose([APPROVE_FEDERATION_PROPOSAL, zeroAddress, 1n], { account: adminA1.account }),
    );
    await wait(orgA.write.approve([1n], { account: adminA2.account }));

    const proposal = await registry.read.getProposal([1n]);
    assert.equal(proposal.approvals, 1n);
    assert.ok(proposal.readyAt > 0n);
    await viem.assertions.revertWithCustomError(registry.write.execute([1n]), registry, "TimelockActive");

    await networkHelpers.time.increaseTo(proposal.executableAt);
    await wait(registry.write.execute([1n], { account: attacker.account }));
    assert.equal(await registry.read.isActiveOrganization([orgC]), true);
    assert.equal(await registry.read.issuingOrganizationOf([adminC.account.address]), getAddress(orgC));

    // The credential issued by A stayed valid throughout.
    assert.equal(await manager.read.isCredentialValid([id]), true);
  });
});
