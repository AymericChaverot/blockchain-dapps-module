// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SitePassBase} from "./SitePassBase.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {Organization} from "../contracts/Organization.sol";

/// @notice Internal multisig of an organization: people (wallets) as admins
///         and issuing members, threshold, timelock, expiry, affiliation sync.
contract OrganizationTest is SitePassBase {
    address internal newcomer = makeAddr("newcomer");

    // ==================================================================
    // Construction
    // ==================================================================

    function test_InitialState() public view {
        address[] memory admins = orgA.getAdmins();
        assertEq(admins.length, 2);
        assertEq(admins[0], adminA1);
        assertEq(admins[1], adminA2);
        assertEq(orgA.getMembers().length, 2);
        assertTrue(orgA.isAdmin(adminA1));
        assertFalse(orgA.isMember(adminA1));
        assertTrue(orgA.isMember(issuerA));
        assertTrue(orgA.isAffiliated(issuerA2));
        assertFalse(orgA.isAffiliated(issuerB));
        assertEq(orgA.threshold(), 2);
        assertEq(orgA.proposalCount(), 0);
    }

    function test_RevertWhen_InvalidComposition() public {
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 0, 0));
        registry.createOrganization("D", "d.example", _list(), 0, _list());
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 0, 1));
        registry.createOrganization("D", "d.example", _list(newcomer), 0, _list());
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 2, 1));
        registry.createOrganization("D", "d.example", _list(newcomer), 2, _list());
        vm.expectRevert(Organization.ZeroAddress.selector);
        registry.createOrganization("D", "d.example", _list(address(0)), 1, _list());
        vm.expectRevert(Organization.ZeroAddress.selector);
        registry.createOrganization("D", "d.example", _list(newcomer), 1, _list(address(0)));
        vm.expectRevert(abi.encodeWithSelector(Organization.AlreadyAdmin.selector, newcomer));
        registry.createOrganization("D", "d.example", _list(newcomer, newcomer), 1, _list());
        vm.expectRevert(abi.encodeWithSelector(Organization.AlreadyMember.selector, worker));
        registry.createOrganization("D", "d.example", _list(newcomer), 1, _list(worker, worker));

        address[] memory many = new address[](21);
        for (uint256 i = 0; i < many.length; ++i) {
            many[i] = address(uint160(0x1000 + i));
        }
        vm.expectRevert(Organization.TooManyAdmins.selector);
        registry.createOrganization("D", "d.example", many, 1, _list());

        address[] memory crowd = new address[](201);
        for (uint256 i = 0; i < crowd.length; ++i) {
            crowd[i] = address(uint160(0x10000 + i));
        }
        vm.expectRevert(Organization.TooManyMembers.selector);
        registry.createOrganization("D", "d.example", _list(newcomer), 1, crowd);
    }

    function test_RevertWhen_ProposingBeyondTheCaps() public {
        address[] memory admins = new address[](20);
        for (uint256 i = 0; i < admins.length; ++i) {
            admins[i] = address(uint160(0x1000 + i));
        }
        address[] memory members = new address[](200);
        for (uint256 i = 0; i < members.length; ++i) {
            members[i] = address(uint160(0x10000 + i));
        }
        Organization full = Organization(registry.createOrganization("Full", "full.example", admins, 1, members));

        vm.startPrank(admins[0]);
        vm.expectRevert(Organization.TooManyAdmins.selector);
        full.propose(Organization.Action.ADD_ADMIN, newcomer, 0);
        vm.expectRevert(Organization.TooManyMembers.selector);
        full.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        vm.stopPrank();
    }

    function test_SamePersonCanBeAdminAndMember() public {
        vm.prank(newcomer);
        Organization org = Organization(registry.createOrganization("D", "d.example", _list(newcomer), 1, _list(newcomer)));
        assertTrue(org.isAdmin(newcomer));
        assertTrue(org.isMember(newcomer));
    }

    // ==================================================================
    // Access
    // ==================================================================

    function test_RevertWhen_NonAdminActs() public {
        vm.prank(issuerA); // member, not admin
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAdmin.selector, issuerA));
        orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);

        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);

        vm.startPrank(adminB); // admin of another organization
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAdmin.selector, adminB));
        orgA.approve(id);
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAdmin.selector, adminB));
        orgA.revokeApproval(id);
        vm.stopPrank();
    }

    // ==================================================================
    // Adding a member: threshold + timelock
    // ==================================================================

    function test_AddMemberNeedsThresholdAndTimelock() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);

        Organization.ProposalView memory p = orgA.getProposal(id);
        assertEq(p.approvals, 1, "the proposer approves");
        assertEq(p.required, 2);
        assertEq(p.approvers[0], adminA1);
        assertTrue(p.timelocked);
        assertEq(p.readyAt, 0);
        assertEq(p.expiresAt, block.timestamp + LIFETIME);
        assertTrue(orgA.hasApproved(id, adminA1));

        vm.expectRevert(abi.encodeWithSelector(Organization.NotEnoughApprovals.selector, id, 1, 2));
        orgA.execute(id);

        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.AlreadyApproved.selector, id, adminA1));
        orgA.approve(id);

        vm.prank(adminA2);
        orgA.approve(id);
        p = orgA.getProposal(id);
        assertEq(p.readyAt, block.timestamp);
        assertEq(p.executableAt, block.timestamp + DELAY);
        assertFalse(orgA.isMember(newcomer), "still timelocked");

        vm.expectRevert(abi.encodeWithSelector(Organization.TimelockActive.selector, id, p.executableAt));
        orgA.execute(id);

        vm.warp(p.executableAt);
        vm.prank(attacker); // execution is permissionless
        assertTrue(orgA.execute(id));

        assertTrue(orgA.isMember(newcomer));
        assertEq(registry.organizationOf(newcomer), address(orgA));
        assertEq(registry.issuingOrganizationOf(newcomer), address(orgA));
        assertTrue(orgA.getProposal(id).executed);

        vm.expectRevert(abi.encodeWithSelector(Organization.ProposalAlreadyExecuted.selector, id));
        orgA.execute(id);
    }

    function test_RevertWhen_AddingSomeoneAffiliatedElsewhere() public {
        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.AffiliatedElsewhere.selector, issuerB, address(orgB)));
        orgA.propose(Organization.Action.ADD_MEMBER, issuerB, 0);

        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.AffiliatedElsewhere.selector, adminB, address(orgB)));
        orgA.propose(Organization.Action.ADD_ADMIN, adminB, 0);
    }

    function test_RevertWhen_AffiliationChangedBeforeExecution() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        vm.prank(adminA2);
        orgA.approve(id);

        // Meanwhile, B recruits the same person.
        _orgRun(orgB, Organization.Action.ADD_MEMBER, newcomer, 0);
        assertEq(registry.organizationOf(newcomer), address(orgB));

        vm.expectRevert(abi.encodeWithSelector(Organization.AffiliatedElsewhere.selector, newcomer, address(orgB)));
        orgA.execute(id);
    }

    function test_RevertWhen_InvalidActionTargets() public {
        vm.startPrank(adminA1);
        vm.expectRevert(Organization.ZeroAddress.selector);
        orgA.propose(Organization.Action.ADD_MEMBER, address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(Organization.AlreadyMember.selector, issuerA));
        orgA.propose(Organization.Action.ADD_MEMBER, issuerA, 0);
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAMember.selector, newcomer));
        orgA.propose(Organization.Action.REMOVE_MEMBER, newcomer, 0);
        vm.expectRevert(abi.encodeWithSelector(Organization.AlreadyAdmin.selector, adminA2));
        orgA.propose(Organization.Action.ADD_ADMIN, adminA2, 0);
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAdmin.selector, newcomer));
        orgA.propose(Organization.Action.REMOVE_ADMIN, newcomer, 0);
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 2, 1));
        orgA.propose(Organization.Action.REMOVE_ADMIN, adminA2, 0); // 2-of-1 impossible
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 3, 2));
        orgA.propose(Organization.Action.SET_THRESHOLD, address(0), 3);
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 0, 2));
        orgA.propose(Organization.Action.SET_THRESHOLD, address(0), 0);
        vm.stopPrank();
    }

    // ==================================================================
    // Removing power: immediate (emergency path)
    // ==================================================================

    function test_RemoveMemberIsImmediateAndUnbinds() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.REMOVE_MEMBER, issuerA2, 0);
        assertTrue(orgA.isMember(issuerA2), "needs the second admin");
        assertFalse(orgA.getProposal(id).timelocked);

        vm.prank(adminA2);
        orgA.approve(id); // runs at once

        assertFalse(orgA.isMember(issuerA2));
        assertEq(orgA.getMembers().length, 1);
        assertEq(orgA.getMembers()[0], issuerA);
        assertEq(registry.organizationOf(issuerA2), address(0));
        assertEq(registry.issuingOrganizationOf(issuerA2), address(0));
        assertFalse(registry.isMemberOf(issuerA2, address(orgA)));
    }

    function test_PersonStaysBoundWhileHoldingAnotherRole() public {
        // adminB becomes a member of B too, then loses the member role only.
        _orgRun(orgB, Organization.Action.ADD_MEMBER, adminB, 0);
        assertEq(registry.issuingOrganizationOf(adminB), address(orgB));
        _orgRun(orgB, Organization.Action.REMOVE_MEMBER, adminB, 0);
        assertEq(registry.organizationOf(adminB), address(orgB), "still an admin");
        assertEq(registry.issuingOrganizationOf(adminB), address(0));
    }

    function test_AdminRotationAndThreshold() public {
        // A: add a third admin (timelocked), then go 2-of-3 -> remove adminA1.
        _orgRun(orgA, Organization.Action.ADD_ADMIN, newcomer, 0);
        assertTrue(orgA.isAdmin(newcomer));
        assertEq(registry.organizationOf(newcomer), address(orgA));

        _orgRun(orgA, Organization.Action.REMOVE_ADMIN, adminA1, 0);
        assertFalse(orgA.isAdmin(adminA1));
        assertEq(orgA.getAdmins().length, 2);
        assertEq(registry.organizationOf(adminA1), address(0));

        _orgRun(orgA, Organization.Action.SET_THRESHOLD, address(0), 1);
        assertEq(orgA.threshold(), 1);

        // 1-of-2 now: a single admin's non-timelocked proposal runs at once.
        vm.prank(newcomer);
        orgA.propose(Organization.Action.REMOVE_MEMBER, issuerA2, 0);
        assertFalse(orgA.isMember(issuerA2));
    }

    function test_ApprovalsOfRemovedAdminsDoNotCount() public {
        _orgRun(orgA, Organization.Action.ADD_ADMIN, newcomer, 0); // 2-of-3

        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, worker, 0);
        assertEq(orgA.getProposal(id).approvals, 1);

        // adminA1 is removed by the two others before the proposal passes.
        _removeAdminWith(adminA1, adminA2, newcomer);
        assertEq(orgA.getProposal(id).approvals, 0);
        assertEq(orgA.getProposal(id).approvers.length, 1, "kept for the record");

        vm.expectRevert(abi.encodeWithSelector(Organization.NotEnoughApprovals.selector, id, 0, 2));
        orgA.execute(id);
    }

    function _removeAdminWith(address target, address first, address second) internal {
        vm.prank(first);
        uint256 id = orgA.propose(Organization.Action.REMOVE_ADMIN, target, 0);
        vm.prank(second);
        orgA.approve(id);
    }

    function test_RevokeApprovalCancelsReadiness() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        vm.prank(adminA2);
        orgA.approve(id);
        assertTrue(orgA.getProposal(id).readyAt != 0);

        vm.prank(adminA1);
        orgA.revokeApproval(id);
        Organization.ProposalView memory p = orgA.getProposal(id);
        assertEq(p.readyAt, 0);
        assertEq(p.approvals, 1);
        assertEq(p.approvers[0], adminA2);
        assertFalse(orgA.hasApproved(id, adminA1));

        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.NotApproved.selector, id, adminA1));
        orgA.revokeApproval(id);
    }

    function test_ExecuteStartsTimelockWhenThresholdWasLowered() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        _orgRun(orgA, Organization.Action.SET_THRESHOLD, address(0), 1);
        assertEq(orgA.getProposal(id).readyAt, 0);

        assertFalse(orgA.execute(id), "first call only starts the timelock");
        Organization.ProposalView memory p = orgA.getProposal(id);
        assertEq(p.readyAt, block.timestamp);
        vm.warp(p.executableAt);
        assertTrue(orgA.execute(id));
        assertTrue(orgA.isMember(newcomer));
    }

    function test_ExecuteRunsNonTimelockedProposalWhenThresholdWasLowered() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.REMOVE_MEMBER, issuerA2, 0);
        _orgRun(orgA, Organization.Action.SET_THRESHOLD, address(0), 1);
        assertTrue(orgA.execute(id));
        assertFalse(orgA.isMember(issuerA2));
    }

    function test_ProposalsExpire() public {
        vm.prank(adminA1);
        uint256 id = orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        Organization.ProposalView memory p = orgA.getProposal(id);
        vm.warp(p.expiresAt);
        assertTrue(orgA.getProposal(id).expired);

        vm.startPrank(adminA2);
        vm.expectRevert(abi.encodeWithSelector(Organization.ProposalExpired.selector, id));
        orgA.approve(id);
        vm.expectRevert(abi.encodeWithSelector(Organization.ProposalExpired.selector, id));
        orgA.execute(id);
        vm.stopPrank();
    }

    function test_RevertWhen_ProposalUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(Organization.ProposalNotFound.selector, 7));
        orgA.getProposal(7);
        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.ProposalNotFound.selector, 7));
        orgA.approve(7);
    }

    function test_ProposalListing() public {
        vm.startPrank(adminA1);
        orgA.propose(Organization.Action.ADD_MEMBER, newcomer, 0);
        orgA.propose(Organization.Action.SET_THRESHOLD, address(0), 1);
        vm.stopPrank();
        Organization.ProposalView[] memory all = orgA.getProposals();
        assertEq(all.length, 2);
        assertEq(uint8(all[1].action), uint8(Organization.Action.SET_THRESHOLD));
        assertEq(all[1].value, 1);
        assertEq(all[0].account, newcomer);
        assertEq(all[0].proposer, adminA1);
    }

    // ==================================================================
    // Leaving
    // ==================================================================

    function test_PersonCanLeave() public {
        vm.prank(issuerA2);
        orgA.leave();
        assertFalse(orgA.isMember(issuerA2));
        assertEq(registry.organizationOf(issuerA2), address(0));

        vm.prank(issuerA2);
        vm.expectRevert(abi.encodeWithSelector(Organization.NotAffiliated.selector, issuerA2));
        orgA.leave();
    }

    function test_AdminCannotLeaveIfThresholdBecomesUnreachable() public {
        vm.prank(adminA1);
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 2, 1));
        orgA.leave();

        vm.prank(adminB); // last admin of B
        vm.expectRevert(abi.encodeWithSelector(Organization.InvalidThreshold.selector, 1, 0));
        orgB.leave();
    }

    function test_AdminWhoIsAlsoMemberLeavesBothRoles() public {
        _orgRun(orgA, Organization.Action.ADD_ADMIN, newcomer, 0);
        _orgRun(orgA, Organization.Action.ADD_MEMBER, newcomer, 0);
        vm.prank(newcomer);
        orgA.leave();
        assertFalse(orgA.isAffiliated(newcomer));
        assertEq(registry.organizationOf(newcomer), address(0));
    }

    // ==================================================================
    // Pending organization: changes are not bound until admission
    // ==================================================================

    function test_PendingOrganizationChangesAreBoundAtAdmission() public {
        address adminD = makeAddr("adminD");
        vm.prank(adminD);
        Organization orgD = Organization(registry.createOrganization("D", "d.example", _list(adminD), 1, _list()));

        _orgRun(orgD, Organization.Action.ADD_MEMBER, newcomer, 0);
        assertTrue(orgD.isMember(newcomer));
        assertEq(registry.organizationOf(newcomer), address(0), "pending: not bound yet");

        vm.prank(adminD);
        uint256 id = registry.proposeAdmission(address(orgD));
        _passWithAB(id);
        assertEq(registry.organizationOf(newcomer), address(orgD));
        assertEq(registry.issuingOrganizationOf(newcomer), address(orgD));
    }

    // ==================================================================
    // Casting the organization's federation vote
    // ==================================================================

    function test_FederationVoteThroughMultisig() public {
        vm.prank(adminB);
        uint256 federationId = registry.proposeQuorum(6_000);

        uint256 id = _orgRun(orgA, Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), federationId);
        assertTrue(orgA.getProposal(id).executed);
        assertTrue(registry.hasApproved(federationId, address(orgA)));

        _orgRun(orgA, Organization.Action.REVOKE_FEDERATION_APPROVAL, address(0), federationId);
        assertFalse(registry.hasApproved(federationId, address(orgA)));
    }

    function test_RevertWhen_FederationRejectsTheVote() public {
        vm.prank(adminB);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.ProposalNotFound.selector, 99));
        orgB.propose(Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), 99);
    }
}
