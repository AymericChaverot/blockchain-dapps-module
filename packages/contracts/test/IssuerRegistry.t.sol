// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SitePassBase} from "./SitePassBase.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {Organization} from "../contracts/Organization.sol";
import {IIssuerRegistry} from "../contracts/interfaces/IIssuerRegistry.sol";

/// @notice Federation governance: no admin, organizations vote through their
///         own multisig, quorum, timelock, expiry, one organization per person.
contract IssuerRegistryTest is SitePassBase {
    address internal adminD = makeAddr("adminD");
    address internal issuerD = makeAddr("issuerD");

    function _createD() internal returns (Organization) {
        vm.prank(adminD);
        return Organization(
            registry.createOrganization("Issuer D", "issuer-d.example", _list(adminD), 1, _list(issuerD))
        );
    }

    function _admitD() internal returns (Organization orgD) {
        orgD = _createD();
        vm.prank(adminD);
        uint256 id = registry.proposeAdmission(address(orgD));
        _passWithAB(id);
    }

    // ==================================================================
    // Deployment: founders, no privileged account
    // ==================================================================

    function test_FoundersAreActiveAndBound() public view {
        assertEq(registry.organizationCount(), 3);
        assertEq(registry.activeOrganizationCount(), 3);
        assertEq(registry.quorumBps(), MAJORITY);
        assertEq(registry.proposalLifetime(), LIFETIME);
        assertEq(registry.timelockDelay(), DELAY);

        IIssuerRegistry.OrganizationInfo memory a = registry.getOrganization(address(orgA));
        assertEq(a.name, "Issuer A");
        assertEq(a.domain, "issuer-a.example");
        assertEq(uint8(a.status), uint8(IIssuerRegistry.OrganizationStatus.ACTIVE));
        assertEq(a.admittedAt, block.timestamp);
        assertTrue(registry.isActiveOrganization(address(orgA)));

        assertEq(registry.organizationOf(adminA1), address(orgA));
        assertEq(registry.organizationOf(issuerA2), address(orgA));
        assertEq(registry.organizationOf(issuerB), address(orgB));
        assertEq(registry.organizationOf(worker), address(0));

        assertEq(registry.issuingOrganizationOf(issuerA), address(orgA));
        assertEq(registry.issuingOrganizationOf(adminA1), address(0), "admins do not issue unless members");
        assertTrue(registry.isMemberOf(issuerA, address(orgA)));
        assertFalse(registry.isMemberOf(issuerA, address(orgB)));
        assertFalse(registry.isMemberOf(issuerA, address(0)));

        assertEq(address(orgA.registry()), address(registry));
        assertEq(orgA.threshold(), 2);
    }

    function test_DeployerHasNoPower() public {
        vm.startPrank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, deployer));
        registry.proposeSuspension(address(orgA));
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, deployer));
        registry.proposeQuorum(10_000);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.OrganizationNotActive.selector, deployer));
        registry.approve(0);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAnOrganization.selector, deployer));
        registry.syncAffiliation(deployer);
        vm.stopPrank();
    }

    function test_RevertWhen_InvalidConstructorArguments() public {
        IssuerRegistry.FoundingOrganization[] memory none = new IssuerRegistry.FoundingOrganization[](0);
        IssuerRegistry.FoundingOrganization[] memory one = new IssuerRegistry.FoundingOrganization[](1);
        one[0] = _founder("Solo", "solo.example", _list(adminD), 1, _list(issuerD));

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.InvalidDurations.selector, 0, 0));
        new IssuerRegistry(0, 0, MAJORITY, one);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.InvalidDurations.selector, DELAY, DELAY));
        new IssuerRegistry(DELAY, DELAY, MAJORITY, one);
        vm.expectRevert(IssuerRegistry.NoFoundingOrganization.selector);
        new IssuerRegistry(LIFETIME, DELAY, MAJORITY, none);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.InvalidQuorum.selector, 4_999));
        new IssuerRegistry(LIFETIME, DELAY, 4_999, one);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.InvalidQuorum.selector, 10_001));
        new IssuerRegistry(LIFETIME, DELAY, 10_001, one);
    }

    function test_RevertWhen_FounderPersonBelongsToTwoOrganizations() public {
        IssuerRegistry.FoundingOrganization[] memory founders = new IssuerRegistry.FoundingOrganization[](2);
        founders[0] = _founder("One", "one.example", _list(adminD), 1, _list(issuerD));
        founders[1] = _founder("Two", "two.example", _list(adminC), 1, _list(issuerD));

        vm.expectRevert(); // AlreadyAffiliated(issuerD, <org One>)
        new IssuerRegistry(LIFETIME, DELAY, MAJORITY, founders);
    }

    // ==================================================================
    // Creating and admitting an organization
    // ==================================================================

    function test_CreateOrganizationIsPendingAndUnbound() public {
        Organization orgD = _createD();
        IIssuerRegistry.OrganizationInfo memory d = registry.getOrganization(address(orgD));
        assertEq(uint8(d.status), uint8(IIssuerRegistry.OrganizationStatus.PENDING));
        assertEq(d.admittedAt, 0);
        assertEq(registry.organizationCount(), 4);
        assertEq(registry.activeOrganizationCount(), 3);
        // People of a pending organization are not bound and cannot issue.
        assertEq(registry.organizationOf(issuerD), address(0));
        assertEq(registry.issuingOrganizationOf(issuerD), address(0));
    }

    function test_RevertWhen_CreatingWithInvalidMetadata() public {
        vm.expectRevert(IssuerRegistry.InvalidName.selector);
        registry.createOrganization("", "d.example", _list(adminD), 1, _list());
        vm.expectRevert(IssuerRegistry.InvalidName.selector);
        registry.createOrganization(string(new bytes(101)), "d.example", _list(adminD), 1, _list());
        vm.expectRevert(IssuerRegistry.InvalidDomain.selector);
        registry.createOrganization("D", "", _list(adminD), 1, _list());
        vm.expectRevert(IssuerRegistry.InvalidDomain.selector);
        registry.createOrganization("D", string(new bytes(254)), _list(adminD), 1, _list());
    }

    function test_AdmissionNeedsQuorumAndTimelock() public {
        Organization orgD = _createD();
        vm.prank(adminD); // a candidate may apply for its own admission
        uint256 id = registry.proposeAdmission(address(orgD));

        _orgApprove(orgA, id);
        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.approvals, 1);
        assertEq(p.required, 2, "strict majority of 3");
        assertEq(p.readyAt, 0);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotEnoughApprovals.selector, id, 1, 2));
        registry.execute(id);

        _orgApprove(orgB, id);
        p = registry.getProposal(id);
        assertEq(p.readyAt, block.timestamp);
        assertEq(p.executableAt, block.timestamp + DELAY);
        assertTrue(p.timelocked);
        assertFalse(p.executed);

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.TimelockActive.selector, id, p.executableAt));
        registry.execute(id);

        vm.warp(p.executableAt);
        vm.expectEmit(true, false, false, false, address(registry));
        emit IssuerRegistry.OrganizationAdmitted(address(orgD));
        vm.prank(attacker); // execution is permissionless
        assertTrue(registry.execute(id));

        assertTrue(registry.isActiveOrganization(address(orgD)));
        assertEq(registry.activeOrganizationCount(), 4);
        assertEq(registry.organizationOf(issuerD), address(orgD));
        assertEq(registry.issuingOrganizationOf(issuerD), address(orgD));
        assertTrue(registry.getProposal(id).executed);

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalAlreadyExecuted.selector, id));
        registry.execute(id);
    }

    function test_RevertWhen_AdmittingOrganizationWithSomeoneElsesPerson() public {
        vm.prank(adminD);
        address orgD = registry.createOrganization("Issuer D", "issuer-d.example", _list(adminD), 1, _list(issuerB));
        vm.prank(adminD);
        uint256 id = registry.proposeAdmission(orgD);
        _orgApprove(orgA, id);
        _orgApprove(orgB, id);
        vm.warp(registry.getProposal(id).executableAt);

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.AlreadyAffiliated.selector, issuerB, address(orgB)));
        registry.execute(id);
    }

    function test_RevertWhen_UnauthorizedProposers() public {
        Organization orgD = _createD();
        // Not an admin of anything.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, attacker));
        registry.proposeAdmission(address(orgD));
        // A member (not admin) of an active organization.
        vm.prank(issuerA);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, issuerA));
        registry.proposeSuspension(address(orgB));
        // An admin of a pending organization can only apply for its own admission.
        vm.prank(adminD);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, adminD));
        registry.proposeSuspension(address(orgB));
    }

    function test_RevertWhen_ProposalTargetsWrongStatus() public {
        Organization orgD = _createD();
        vm.startPrank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.UnknownOrganization.selector, attacker));
        registry.proposeAdmission(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistry.InvalidOrganizationStatus.selector, address(orgB), IIssuerRegistry.OrganizationStatus.ACTIVE
            )
        );
        registry.proposeAdmission(address(orgB));
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistry.InvalidOrganizationStatus.selector,
                address(orgD),
                IIssuerRegistry.OrganizationStatus.PENDING
            )
        );
        registry.proposeSuspension(address(orgD));
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistry.InvalidOrganizationStatus.selector,
                address(orgD),
                IIssuerRegistry.OrganizationStatus.PENDING
            )
        );
        registry.proposeUpdate(address(orgD), "D", "d.example");
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistry.InvalidOrganizationStatus.selector, address(orgB), IIssuerRegistry.OrganizationStatus.ACTIVE
            )
        );
        registry.proposeReinstatement(address(orgB));
        vm.expectRevert(IssuerRegistry.InvalidName.selector);
        registry.proposeUpdate(address(orgB), "", "b.example");
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.InvalidQuorum.selector, 4_000));
        registry.proposeQuorum(4_000);
        vm.stopPrank();
    }

    // ==================================================================
    // Votes are cast by organizations, never by individuals
    // ==================================================================

    function test_RevertWhen_PersonOrPendingOrganizationVotes() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeSuspension(address(orgC));

        // An admin's own wallet is not a vote.
        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.OrganizationNotActive.selector, adminA1));
        registry.approve(id);

        // A pending organization cannot vote.
        Organization orgD = _createD();
        vm.prank(adminD);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.OrganizationNotActive.selector, address(orgD)));
        orgD.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), id);
    }

    function test_OneAdminOfA2of2OrganizationCannotVoteAlone() public {
        vm.prank(adminB);
        uint256 id = registry.proposeSuspension(address(orgC));

        vm.prank(adminA1);
        uint256 internalId = orgA.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), id);
        assertFalse(registry.hasApproved(id, address(orgA)), "1 of 2 admins is not enough");

        vm.prank(adminA2);
        orgA.approve(internalId);
        assertTrue(registry.hasApproved(id, address(orgA)));
    }

    function test_RevertWhen_ApprovingTwiceOrRevokingWithoutApproval() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(6_000);
        _orgApprove(orgA, id);

        vm.prank(address(orgA));
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.AlreadyApproved.selector, id, address(orgA)));
        registry.approve(id);

        vm.prank(address(orgB));
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotApproved.selector, id, address(orgB)));
        registry.revokeApproval(id);
    }

    function test_RevokingAnApprovalCancelsReadiness() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(6_000);
        _orgApprove(orgB, id);
        _orgApprove(orgC, id);
        _orgApprove(orgA, id);
        assertTrue(registry.getProposal(id).readyAt != 0);

        // B and C withdraw: 1 of 2 required left.
        _orgRun(orgB, Organization.Action.REVOKE_FEDERATION_APPROVAL, address(0), id);
        assertTrue(registry.getProposal(id).readyAt != 0, "still 2 approvals");
        _orgRun(orgC, Organization.Action.REVOKE_FEDERATION_APPROVAL, address(0), id);

        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.readyAt, 0);
        assertEq(p.approvals, 1);
        assertEq(p.approvers.length, 1);
        assertEq(p.approvers[0], address(orgA));
        assertFalse(registry.hasApproved(id, address(orgB)));
    }

    // ==================================================================
    // Suspension: emergency path, no timelock
    // ==================================================================

    function test_SuspensionRunsAsSoonAsQuorumIsReached() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeSuspension(address(orgC));
        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.required, 2, "C is not eligible: 2 voters, strict majority = 2");
        assertFalse(p.timelocked);

        _orgApprove(orgA, id);
        assertTrue(registry.isActiveOrganization(address(orgC)));

        _orgApprove(orgB, id);

        assertEq(uint8(_status(address(orgC))), uint8(IIssuerRegistry.OrganizationStatus.SUSPENDED));
        assertEq(registry.activeOrganizationCount(), 2);
        assertTrue(registry.getProposal(id).executed);
        // Its people stay bound (they can still revoke) but cannot issue.
        assertEq(registry.organizationOf(issuerC), address(orgC));
        assertEq(registry.issuingOrganizationOf(issuerC), address(0));
        assertTrue(registry.isMemberOf(issuerC, address(orgC)));
    }

    function test_RevertWhen_OrganizationVotesOnItsOwnSuspension() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeSuspension(address(orgC));
        vm.prank(adminC);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.CannotVoteOnOwnSuspension.selector, address(orgC)));
        orgC.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), id);
    }

    function test_SuspendedOrganizationCannotVoteAndItsVotesStopCounting() public {
        vm.prank(adminA1);
        uint256 quorumId = registry.proposeQuorum(6_000);
        _orgApprove(orgC, quorumId);
        assertEq(registry.getProposal(quorumId).approvals, 1);

        _suspendC();
        IssuerRegistry.ProposalView memory p = registry.getProposal(quorumId);
        assertEq(p.approvals, 0, "a suspended organization's vote no longer counts");
        assertEq(p.required, 2);

        vm.prank(adminC);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.OrganizationNotActive.selector, address(orgC)));
        orgC.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), quorumId);

        // A suspended organization's admins can no longer propose.
        vm.prank(adminC);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotAuthorizedProposer.selector, adminC));
        registry.proposeSuspension(address(orgA));
    }

    function test_RevertWhen_SuspendingTheLastActiveOrganization() public {
        _suspendC();
        Organization[] memory voters = new Organization[](1);
        voters[0] = orgA;
        _suspend(orgB, voters); // 1 eligible voter (A): strict majority = 1
        assertEq(registry.activeOrganizationCount(), 1);

        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.LastActiveOrganization.selector, address(orgA)));
        registry.proposeSuspension(address(orgA));
    }

    function test_StaleSuspensionOfTheLastActiveOrganizationCannotPass() public {
        vm.prank(adminB);
        uint256 stale = registry.proposeSuspension(address(orgA)); // valid while 3 are active
        _suspendC();
        Organization[] memory voters = new Organization[](1);
        voters[0] = orgA;
        _suspend(orgB, voters);

        IssuerRegistry.ProposalView memory p = registry.getProposal(stale);
        assertEq(p.required, 1, "no eligible voter left: unreachable");
        assertEq(p.approvals, 0);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.NotEnoughApprovals.selector, stale, 0, 1));
        registry.execute(stale);
    }

    function test_ReinstatementIsTimelocked() public {
        _suspendC();
        vm.prank(adminA1);
        uint256 id = registry.proposeReinstatement(address(orgC));
        _passWithAB(id);

        assertTrue(registry.isActiveOrganization(address(orgC)));
        assertEq(registry.activeOrganizationCount(), 3);
        assertEq(registry.issuingOrganizationOf(issuerC), address(orgC));
    }

    // ==================================================================
    // Metadata update and quorum change
    // ==================================================================

    function test_UpdateMetadataByVote() public {
        vm.prank(adminB);
        uint256 id = registry.proposeUpdate(address(orgB), "Issuer B (renamed)", "issuer-b.example.org");
        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.name, "Issuer B (renamed)");
        assertEq(p.domain, "issuer-b.example.org");
        _passWithAB(id);

        IIssuerRegistry.OrganizationInfo memory b = registry.getOrganization(address(orgB));
        assertEq(b.name, "Issuer B (renamed)");
        assertEq(b.domain, "issuer-b.example.org");
        assertEq(b.updatedAt, block.timestamp);
    }

    function test_UnanimityQuorum() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(10_000);
        _passWithAB(id);
        assertEq(registry.quorumBps(), 10_000);

        vm.prank(adminA1);
        uint256 next = registry.proposeQuorum(5_000);
        assertEq(registry.getProposal(next).required, 3);
        _orgApprove(orgA, next);
        _orgApprove(orgB, next);
        assertEq(registry.getProposal(next).readyAt, 0, "2 of 3 is not unanimity");
        _orgApprove(orgC, next);
        vm.warp(registry.getProposal(next).executableAt);
        registry.execute(next);
        assertEq(registry.quorumBps(), 5_000);
    }

    function testFuzz_RequiredApprovalsIsStrictlyAboveQuorum(uint16 quorum) public {
        quorum = uint16(bound(quorum, 5_000, 10_000));
        Organization orgD = _admitD(); // 4 voters: strict majority = 3

        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(quorum);
        _orgApprove(orgA, id);
        _orgApprove(orgB, id);
        _orgApprove(orgC, id);
        vm.warp(registry.getProposal(id).executableAt);
        registry.execute(id);
        assertEq(registry.quorumBps(), quorum);

        vm.prank(adminA1);
        uint256 probe = registry.proposeUpdate(address(orgD), "D", "d.example");
        uint256 required = registry.getProposal(probe).required;
        // Strictly more than quorum% of 4 voters, capped at all 4.
        assertTrue(required == 4 || required * 10_000 > uint256(quorum) * 4);
        assertTrue((required - 1) * 10_000 <= uint256(quorum) * 4, "smallest such number");
        assertGe(required, 3);
        assertLe(required, 4);
    }

    // ==================================================================
    // Expiry and late quorum
    // ==================================================================

    function test_ProposalsExpire() public {
        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(6_000);
        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.expiresAt, block.timestamp + LIFETIME);

        vm.warp(p.expiresAt);
        assertTrue(registry.getProposal(id).expired);
        vm.prank(adminB);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalExpired.selector, id));
        orgB.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), id);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalExpired.selector, id));
        registry.execute(id);
    }

    function test_ExecuteStartsTimelockWhenQuorumWasReachedPassively() public {
        Organization orgD = _admitD(); // 4 voters: strict majority = 3
        vm.prank(adminA1);
        uint256 id = registry.proposeQuorum(6_000);
        _orgApprove(orgA, id);
        _orgApprove(orgB, id);
        assertEq(registry.getProposal(id).readyAt, 0, "2 of 4");

        // D gets suspended by A, B, C: 3 voters left, 2 approvals now suffice.
        vm.prank(adminA1);
        uint256 suspension = registry.proposeSuspension(address(orgD));
        _orgApprove(orgA, suspension);
        _orgApprove(orgB, suspension);
        assertFalse(registry.isActiveOrganization(address(orgD)));

        assertFalse(registry.execute(id), "first call only starts the timelock");
        IssuerRegistry.ProposalView memory p = registry.getProposal(id);
        assertEq(p.readyAt, block.timestamp);
        vm.warp(p.executableAt);
        assertTrue(registry.execute(id));
        assertEq(registry.quorumBps(), 6_000);
    }

    function test_RevertWhen_ProposalUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalNotFound.selector, 42));
        registry.getProposal(42);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalNotFound.selector, 42));
        registry.execute(42);
    }

    function test_ProposalListing() public {
        vm.startPrank(adminA1);
        registry.proposeQuorum(6_000);
        registry.proposeSuspension(address(orgC));
        vm.stopPrank();
        assertEq(registry.proposalCount(), 2);
        IssuerRegistry.ProposalView[] memory all = registry.getProposals();
        assertEq(all.length, 2);
        assertEq(uint8(all[1].kind), uint8(IssuerRegistry.ProposalKind.SUSPEND));
        assertEq(all[1].target, address(orgC));
        assertEq(all[1].proposer, adminA1);
    }
}
