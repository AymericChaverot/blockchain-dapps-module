// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {IIssuerRegistry} from "../contracts/interfaces/IIssuerRegistry.sol";
import {SiteCredentialManager} from "../contracts/SiteCredentialManager.sol";

/// @notice Unit tests of credential issuance, revocation, verification,
///         non-transferability and expiration.
///
/// The six scenarios required for the defense are grouped under the
/// "SCENARIO n" banners below; the other tests cover edge cases.
contract SiteCredentialManagerTest is Test {
    IssuerRegistry internal registry;
    SiteCredentialManager internal manager;

    address internal admin = makeAddr("registryAdmin");
    address internal issuerA = makeAddr("Issuer A");
    address internal issuerB = makeAddr("Issuer B");
    address internal worker = makeAddr("worker");
    address internal otherWorker = makeAddr("otherWorker");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant TYPE_PR1 = bytes32("NUC-PR1-CC");
    bytes32 internal constant TYPE_B2V = bytes32("ELEC-B2V");
    // Stand-ins for SHA-256 fingerprints. keccak256 is folded at compile time,
    // whereas sha256 is a precompile call that would consume `vm.prank`.
    bytes32 internal constant DOC_HASH = keccak256("{\"schema\":\"sitepass.credential.v1\",\"salt\":\"0x01\"}");
    bytes32 internal constant DOC_HASH_2 = keccak256("{\"schema\":\"sitepass.credential.v1\",\"salt\":\"0x02\"}");

    uint8 internal constant SAFETY_BREACH = 1;
    uint8 internal constant MEDICAL_UNFIT = 2;
    uint8 internal constant EXPIRED_EARLY = 3;
    uint8 internal constant FRAUDULENT_ISSUANCE = 4;

    function setUp() public {
        vm.warp(1_760_000_000); // realistic "now" (Oct 2025)
        registry = new IssuerRegistry(admin);
        manager = new SiteCredentialManager(registry);

        vm.startPrank(admin);
        registry.addIssuer(issuerA, "Issuer A", "issuer-a.example");
        registry.addIssuer(issuerB, "Issuer B", "issuer-b.example");
        vm.stopPrank();
    }

    function _issue(address issuer, bytes32 docHash, uint64 expiresAt) internal returns (bytes32 id) {
        vm.prank(issuer);
        id = manager.issueCredential(worker, TYPE_PR1, docHash, expiresAt);
    }

    // ==================================================================
    // SCENARIO 1 - Valid issuance by an accredited issuer
    // ==================================================================

    function test_Scenario1_IssueByAccreditedIssuer() public {
        uint64 expiresAt = uint64(block.timestamp + 365 days);
        bytes32 expectedId = manager.computeCredentialId(issuerA, DOC_HASH);

        vm.expectEmit(true, true, true, true, address(manager));
        emit SiteCredentialManager.CredentialIssued(
            expectedId, issuerA, worker, TYPE_PR1, DOC_HASH, uint64(block.timestamp), expiresAt
        );

        vm.prank(issuerA);
        bytes32 id = manager.issueCredential(worker, TYPE_PR1, DOC_HASH, expiresAt);
        assertEq(id, expectedId);

        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertTrue(v.exists);
        assertTrue(v.isValid);
        assertEq(uint8(v.status), uint8(SiteCredentialManager.CredentialStatus.VALID));
        assertEq(v.issuer, issuerA);
        assertEq(v.issuerName, "Issuer A");
        assertEq(v.issuerDomain, "issuer-a.example");
        assertTrue(v.issuerActive);
        assertEq(v.holder, worker);
        assertEq(v.credentialType, TYPE_PR1);
        assertEq(v.documentHash, DOC_HASH);
        assertEq(v.issuedAt, block.timestamp);
        assertEq(v.expiresAt, expiresAt);
        assertFalse(v.isExpired);
        assertFalse(v.isRevoked);
        assertEq(v.revokedAt, 0);
        assertEq(v.revocationReason, 0);
        assertTrue(manager.isCredentialValid(id));
    }

    function test_Scenario1_IndexesAreUpdated() public {
        bytes32 id1 = _issue(issuerA, DOC_HASH, 0);
        vm.prank(issuerB);
        bytes32 id2 = manager.issueCredential(worker, TYPE_B2V, DOC_HASH_2, 0);

        bytes32[] memory byHolder = manager.getCredentialsByHolder(worker);
        assertEq(byHolder.length, 2);
        assertEq(byHolder[0], id1);
        assertEq(byHolder[1], id2);

        assertEq(manager.getCredentialsByIssuer(issuerA).length, 1);
        assertEq(manager.getCredentialsByIssuer(issuerA)[0], id1);
        assertEq(manager.getCredentialsByIssuer(issuerB)[0], id2);
        assertEq(manager.getCredentialsByDocumentHash(DOC_HASH)[0], id1);
        assertEq(manager.getCredentialsByHolder(otherWorker).length, 0);
        assertEq(manager.totalCredentials(), 2);
    }

    function test_Scenario1_TwoIssuersCanAnchorTheSameDocument() public {
        bytes32 id1 = _issue(issuerA, DOC_HASH, 0);
        bytes32 id2 = _issue(issuerB, DOC_HASH, 0);
        assertTrue(id1 != id2);
        assertEq(manager.getCredentialsByDocumentHash(DOC_HASH).length, 2);
    }

    // ==================================================================
    // SCENARIO 2 - Issuance by a non-registered address must revert
    // ==================================================================

    function test_Scenario2_RevertWhen_UnregisteredAddressIssues() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotAuthorizedIssuer.selector, attacker));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, 0);

        assertEq(manager.getCredentialsByHolder(worker).length, 0);
        assertEq(manager.totalCredentials(), 0);
    }

    function test_Scenario2_RevertWhen_RegistryAdminIssues() public {
        // Administering the registry does not grant issuance rights.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotAuthorizedIssuer.selector, admin));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, 0);
    }

    function test_Scenario2_RevertWhen_SuspendedIssuerIssues() public {
        vm.prank(admin);
        registry.suspendIssuer(issuerB);

        vm.prank(issuerB);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotAuthorizedIssuer.selector, issuerB));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, 0);
    }

    function testFuzz_Scenario2_NoOneElseCanIssue(address caller) public {
        vm.assume(caller != issuerA && caller != issuerB);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotAuthorizedIssuer.selector, caller));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, 0);
    }

    function test_RevertWhen_InvalidIssuanceInputs() public {
        vm.startPrank(issuerA);
        vm.expectRevert(SiteCredentialManager.ZeroAddress.selector);
        manager.issueCredential(address(0), TYPE_PR1, DOC_HASH, 0);

        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.SelfIssuanceNotAllowed.selector, issuerA));
        manager.issueCredential(issuerA, TYPE_PR1, DOC_HASH, 0);

        vm.expectRevert(SiteCredentialManager.InvalidCredentialType.selector);
        manager.issueCredential(worker, bytes32(0), DOC_HASH, 0);

        vm.expectRevert(SiteCredentialManager.InvalidDocumentHash.selector);
        manager.issueCredential(worker, TYPE_PR1, bytes32(0), 0);
        vm.stopPrank();
    }

    function test_RevertWhen_IssuingTheSameDocumentTwice() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);
        vm.prank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialAlreadyExists.selector, id));
        manager.issueCredential(otherWorker, TYPE_PR1, DOC_HASH, 0);
    }

    function test_RevertWhen_RegistryIsZero() public {
        vm.expectRevert(SiteCredentialManager.ZeroAddress.selector);
        new SiteCredentialManager(IIssuerRegistry(address(0)));
    }

    // ==================================================================
    // SCENARIO 3 - Valid revocation by the original issuer
    // ==================================================================

    function test_Scenario3_RevokeByOriginalIssuer() public {
        bytes32 id = _issue(issuerA, DOC_HASH, uint64(block.timestamp + 365 days));
        vm.warp(block.timestamp + 10 days);

        vm.expectEmit(true, true, true, true, address(manager));
        emit SiteCredentialManager.CredentialRevoked(id, issuerA, worker, SAFETY_BREACH, uint64(block.timestamp));

        vm.prank(issuerA);
        manager.revokeCredential(id, SAFETY_BREACH);

        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertTrue(v.exists, "revocation must not delete the record");
        assertFalse(v.isValid);
        assertTrue(v.isRevoked);
        assertEq(uint8(v.status), uint8(SiteCredentialManager.CredentialStatus.REVOKED));
        assertEq(v.revokedAt, block.timestamp);
        assertEq(v.revocationReason, SAFETY_BREACH);
        // Original data is preserved for auditability.
        assertEq(v.issuer, issuerA);
        assertEq(v.holder, worker);
        assertEq(v.documentHash, DOC_HASH);
        assertEq(v.credentialType, TYPE_PR1);
        assertEq(manager.getCredentialsByHolder(worker).length, 1);
    }

    function test_Scenario3_AllReasonCodesAreAccepted() public {
        uint8[4] memory reasons = [SAFETY_BREACH, MEDICAL_UNFIT, EXPIRED_EARLY, FRAUDULENT_ISSUANCE];
        for (uint256 i = 0; i < reasons.length; ++i) {
            bytes32 id = _issue(issuerA, keccak256(abi.encode("doc", i)), 0);
            vm.prank(issuerA);
            manager.revokeCredential(id, reasons[i]);
            assertEq(manager.verifyCredential(id).revocationReason, reasons[i]);
        }
    }

    function test_Scenario3_SuspendedIssuerCanStillRevoke() public {
        bytes32 id = _issue(issuerB, DOC_HASH, 0);
        vm.prank(admin);
        registry.suspendIssuer(issuerB);

        vm.prank(issuerB);
        manager.revokeCredential(id, FRAUDULENT_ISSUANCE);
        assertTrue(manager.verifyCredential(id).isRevoked);
    }

    // ==================================================================
    // SCENARIO 4 - Revocation by a third-party issuer or attacker reverts
    // ==================================================================

    function test_Scenario4_RevertWhen_OtherIssuerRevokes() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);

        vm.prank(issuerB);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotCredentialIssuer.selector, id, issuerB));
        manager.revokeCredential(id, SAFETY_BREACH);
        assertTrue(manager.isCredentialValid(id));
    }

    function test_Scenario4_RevertWhen_AttackerRevokes() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotCredentialIssuer.selector, id, attacker));
        manager.revokeCredential(id, SAFETY_BREACH);
        assertTrue(manager.isCredentialValid(id));
    }

    function test_Scenario4_RevertWhen_RegistryAdminOrHolderRevokes() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotCredentialIssuer.selector, id, admin));
        manager.revokeCredential(id, SAFETY_BREACH);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotCredentialIssuer.selector, id, worker));
        manager.revokeCredential(id, SAFETY_BREACH);
    }

    function testFuzz_Scenario4_OnlyOriginalIssuerCanRevoke(address caller) public {
        vm.assume(caller != issuerA);
        bytes32 id = _issue(issuerA, DOC_HASH, 0);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.NotCredentialIssuer.selector, id, caller));
        manager.revokeCredential(id, SAFETY_BREACH);
    }

    function test_RevertWhen_RevokingTwice() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);
        vm.startPrank(issuerA);
        manager.revokeCredential(id, MEDICAL_UNFIT);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialAlreadyRevoked.selector, id));
        manager.revokeCredential(id, SAFETY_BREACH);
        vm.stopPrank();
        // The first reason is kept.
        assertEq(manager.verifyCredential(id).revocationReason, MEDICAL_UNFIT);
    }

    function test_RevertWhen_RevokingUnknownCredential() public {
        bytes32 unknownId = keccak256("unknown");
        vm.prank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialNotFound.selector, unknownId));
        manager.revokeCredential(unknownId, SAFETY_BREACH);
    }

    function testFuzz_RevertWhen_InvalidReasonCode(uint8 reasonCode) public {
        vm.assume(reasonCode == 0 || reasonCode > FRAUDULENT_ISSUANCE);
        bytes32 id = _issue(issuerA, DOC_HASH, 0);
        vm.prank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.InvalidRevocationReason.selector, reasonCode));
        manager.revokeCredential(id, reasonCode);
    }

    // ==================================================================
    // SCENARIO 5 - No transfer primitive: a badge cannot be handed over
    // ==================================================================

    function test_Scenario5_TransferCredentialAlwaysReverts() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialNonTransferable.selector, id));
        manager.transferCredential(id, otherWorker);

        // Even the issuer cannot move it.
        vm.prank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialNonTransferable.selector, id));
        manager.transferCredential(id, otherWorker);

        assertEq(manager.verifyCredential(id).holder, worker);
        assertEq(manager.getCredentialsByHolder(otherWorker).length, 0);
    }

    function test_Scenario5_TransferOfUnknownCredentialReverts() public {
        bytes32 unknownId = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.CredentialNotFound.selector, unknownId));
        manager.transferCredential(unknownId, otherWorker);
    }

    function test_Scenario5_NoTokenTransferSelectorsExist() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);
        uint256 tokenId = uint256(id);

        bytes[] memory calls = new bytes[](7);
        calls[0] = abi.encodeWithSignature("transferFrom(address,address,uint256)", worker, otherWorker, tokenId);
        calls[1] = abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", worker, otherWorker, tokenId);
        calls[2] =
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256,bytes)", worker, otherWorker, tokenId, "");
        calls[3] = abi.encodeWithSignature("approve(address,uint256)", otherWorker, tokenId);
        calls[4] = abi.encodeWithSignature("setApprovalForAll(address,bool)", otherWorker, true);
        calls[5] = abi.encodeWithSignature("transfer(address,uint256)", otherWorker, tokenId);
        calls[6] = abi.encodeWithSignature("ownerOf(uint256)", tokenId);

        vm.startPrank(worker);
        for (uint256 i = 0; i < calls.length; ++i) {
            (bool ok,) = address(manager).call(calls[i]);
            assertFalse(ok, "token-like selector must not exist");
        }
        vm.stopPrank();

        assertEq(manager.verifyCredential(id).holder, worker);
    }

    function test_Scenario5_ContractRejectsEther() public {
        vm.deal(worker, 1 ether);
        vm.prank(worker);
        (bool ok,) = address(manager).call{value: 1 wei}("");
        assertFalse(ok);
    }

    // ==================================================================
    // SCENARIO 6 - Time-based expiration
    // ==================================================================

    function test_Scenario6_ExpirationBoundaries() public {
        uint64 expiresAt = uint64(block.timestamp + 30 days);
        bytes32 id = _issue(issuerA, DOC_HASH, expiresAt);

        vm.warp(expiresAt - 1);
        SiteCredentialManager.CredentialView memory before = manager.verifyCredential(id);
        assertTrue(before.isValid, "valid one second before expiry");
        assertFalse(before.isExpired);

        vm.warp(expiresAt);
        SiteCredentialManager.CredentialView memory atExpiry = manager.verifyCredential(id);
        assertFalse(atExpiry.isValid, "expired exactly at expiresAt");
        assertTrue(atExpiry.isExpired);
        assertEq(uint8(atExpiry.status), uint8(SiteCredentialManager.CredentialStatus.EXPIRED));

        vm.warp(expiresAt + 365 days);
        assertEq(uint8(manager.verifyCredential(id).status), uint8(SiteCredentialManager.CredentialStatus.EXPIRED));
    }

    function test_Scenario6_ZeroExpirationNeverExpires() public {
        bytes32 id = _issue(issuerA, DOC_HASH, 0);
        vm.warp(block.timestamp + 100 * 365 days);
        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertTrue(v.isValid);
        assertFalse(v.isExpired);
    }

    function test_Scenario6_RevertWhen_ExpirationNotInTheFuture() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.startPrank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.InvalidExpiration.selector, nowTs, nowTs));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, nowTs);

        vm.expectRevert(abi.encodeWithSelector(SiteCredentialManager.InvalidExpiration.selector, nowTs - 1, nowTs));
        manager.issueCredential(worker, TYPE_PR1, DOC_HASH, nowTs - 1);
        vm.stopPrank();
    }

    function test_Scenario6_RevocationTakesPrecedenceOverExpiration() public {
        uint64 expiresAt = uint64(block.timestamp + 1 days);
        bytes32 id = _issue(issuerA, DOC_HASH, expiresAt);
        vm.prank(issuerA);
        manager.revokeCredential(id, EXPIRED_EARLY);

        vm.warp(expiresAt + 1);
        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertTrue(v.isExpired);
        assertTrue(v.isRevoked);
        assertEq(uint8(v.status), uint8(SiteCredentialManager.CredentialStatus.REVOKED));
    }

    function testFuzz_Scenario6_ExpiryIsComputedFromBlockTime(uint32 lifetime, uint32 elapsed) public {
        vm.assume(lifetime > 0);
        uint64 expiresAt = uint64(block.timestamp) + lifetime;
        bytes32 id = _issue(issuerA, DOC_HASH, expiresAt);

        vm.warp(block.timestamp + elapsed);
        bool shouldBeExpired = block.timestamp >= expiresAt;
        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertEq(v.isExpired, shouldBeExpired);
        assertEq(v.isValid, !shouldBeExpired);
    }

    // ==================================================================
    // Verification edge cases
    // ==================================================================

    function test_UnknownCredentialIsReportedAsUnknown() public view {
        bytes32 unknownId = keccak256("unknown");
        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(unknownId);
        assertEq(v.id, unknownId);
        assertFalse(v.exists);
        assertFalse(v.isValid);
        assertEq(uint8(v.status), uint8(SiteCredentialManager.CredentialStatus.UNKNOWN));
        assertEq(v.issuer, address(0));
        assertFalse(manager.isCredentialValid(unknownId));
    }

    function test_SuspendingIssuerInvalidatesItsCredentials() public {
        bytes32 id = _issue(issuerB, DOC_HASH, 0);

        vm.prank(admin);
        registry.suspendIssuer(issuerB);
        SiteCredentialManager.CredentialView memory v = manager.verifyCredential(id);
        assertFalse(v.isValid);
        assertFalse(v.issuerActive);
        assertEq(uint8(v.status), uint8(SiteCredentialManager.CredentialStatus.ISSUER_SUSPENDED));
        assertEq(v.issuerName, "Issuer B", "issuer identity is still displayed");

        vm.prank(admin);
        registry.reinstateIssuer(issuerB);
        assertTrue(manager.isCredentialValid(id));
    }

    function test_BatchVerification() public {
        bytes32 id1 = _issue(issuerA, DOC_HASH, 0);
        bytes32 id2 = _issue(issuerA, DOC_HASH_2, 0);
        vm.prank(issuerA);
        manager.revokeCredential(id2, SAFETY_BREACH);

        bytes32[] memory ids = new bytes32[](3);
        ids[0] = id1;
        ids[1] = id2;
        ids[2] = keccak256("unknown");
        SiteCredentialManager.CredentialView[] memory results = manager.verifyCredentials(ids);

        assertEq(results.length, 3);
        assertEq(uint8(results[0].status), uint8(SiteCredentialManager.CredentialStatus.VALID));
        assertEq(uint8(results[1].status), uint8(SiteCredentialManager.CredentialStatus.REVOKED));
        assertEq(uint8(results[2].status), uint8(SiteCredentialManager.CredentialStatus.UNKNOWN));
    }

    function test_CredentialIdIsBoundToChainContractIssuerAndDocument() public view {
        bytes32 id = manager.computeCredentialId(issuerA, DOC_HASH);
        assertEq(id, keccak256(abi.encode(block.chainid, address(manager), issuerA, DOC_HASH)));
        assertTrue(id != manager.computeCredentialId(issuerB, DOC_HASH));
        assertTrue(id != manager.computeCredentialId(issuerA, DOC_HASH_2));
    }
}
