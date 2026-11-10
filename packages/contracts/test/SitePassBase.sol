// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {Organization} from "../contracts/Organization.sol";
import {SiteCredentialManager} from "../contracts/SiteCredentialManager.sol";
import {IIssuerRegistry} from "../contracts/interfaces/IIssuerRegistry.sol";

/// @notice Shared fixture: a federation of three founding organizations.
///
///   Org A: admins adminA1 + adminA2 (2-of-2), members issuerA + issuerA2
///   Org B: admin adminB (1-of-1),            member  issuerB
///   Org C: admin adminC (1-of-1),            member  issuerC
///
/// Quorum: strict majority (5 000 bps) -> 2 of 3 organizations.
abstract contract SitePassBase is Test {
    uint64 internal constant LIFETIME = 7 days;
    uint64 internal constant DELAY = 2 days;
    uint16 internal constant MAJORITY = 5_000;

    IssuerRegistry internal registry;
    SiteCredentialManager internal manager;
    Organization internal orgA;
    Organization internal orgB;
    Organization internal orgC;

    address internal deployer = makeAddr("deployer");
    address internal adminA1 = makeAddr("adminA1");
    address internal adminA2 = makeAddr("adminA2");
    address internal issuerA = makeAddr("issuerA");
    address internal issuerA2 = makeAddr("issuerA2");
    address internal adminB = makeAddr("adminB");
    address internal issuerB = makeAddr("issuerB");
    address internal adminC = makeAddr("adminC");
    address internal issuerC = makeAddr("issuerC");
    address internal worker = makeAddr("worker");
    address internal otherWorker = makeAddr("otherWorker");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        vm.warp(1_760_000_000); // realistic "now" (Oct 2025)

        IssuerRegistry.FoundingOrganization[] memory founders = new IssuerRegistry.FoundingOrganization[](3);
        founders[0] = _founder("Issuer A", "issuer-a.example", _list(adminA1, adminA2), 2, _list(issuerA, issuerA2));
        founders[1] = _founder("Issuer B", "issuer-b.example", _list(adminB), 1, _list(issuerB));
        founders[2] = _founder("Issuer C", "issuer-c.example", _list(adminC), 1, _list(issuerC));

        vm.startPrank(deployer);
        registry = new IssuerRegistry(LIFETIME, DELAY, MAJORITY, founders);
        manager = new SiteCredentialManager(registry);
        vm.stopPrank();

        address[] memory orgs = registry.getOrganizationAccounts();
        orgA = Organization(orgs[0]);
        orgB = Organization(orgs[1]);
        orgC = Organization(orgs[2]);
    }

    // ------------------------------------------------------------------
    // Builders
    // ------------------------------------------------------------------

    function _founder(
        string memory name,
        string memory domain,
        address[] memory admins,
        uint256 threshold,
        address[] memory members
    ) internal pure returns (IssuerRegistry.FoundingOrganization memory) {
        return IssuerRegistry.FoundingOrganization({
            name: name,
            domain: domain,
            admins: admins,
            threshold: threshold,
            members: members
        });
    }

    function _list() internal pure returns (address[] memory list) {
        list = new address[](0);
    }

    function _list(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _list(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    // ------------------------------------------------------------------
    // Governance helpers
    // ------------------------------------------------------------------

    /// @dev Makes `org` cast its federation vote through its internal multisig.
    function _orgApprove(Organization org, uint256 federationProposalId) internal {
        _orgRun(org, Organization.Action.APPROVE_FEDERATION_PROPOSAL, address(0), federationProposalId);
    }

    /// @dev Runs a proposal through `org`'s multisig with exactly `threshold`
    ///      approvals (and the timelock when needed).
    function _orgRun(Organization org, Organization.Action action, address account, uint256 value)
        internal
        returns (uint256 id)
    {
        address[] memory admins = org.getAdmins();
        uint256 threshold = org.threshold();
        vm.prank(admins[0]);
        id = org.propose(action, account, value);
        for (uint256 i = 1; i < threshold; ++i) {
            vm.prank(admins[i]);
            org.approve(id);
        }
        Organization.ProposalView memory p = org.getProposal(id);
        if (!p.executed) {
            vm.warp(p.executableAt);
            org.execute(id);
        }
    }

    /// @dev Suspends `target` with the votes of `voters`.
    function _suspend(Organization target, Organization[] memory voters) internal {
        vm.prank(_firstAdmin(voters[0]));
        uint256 id = registry.proposeSuspension(address(target));
        for (uint256 i = 0; i < voters.length; ++i) {
            _orgApprove(voters[i], id);
        }
    }

    function _suspendC() internal {
        Organization[] memory voters = new Organization[](2);
        voters[0] = orgA;
        voters[1] = orgB;
        _suspend(orgC, voters);
    }

    function _suspendB() internal {
        Organization[] memory voters = new Organization[](2);
        voters[0] = orgA;
        voters[1] = orgC;
        _suspend(orgB, voters);
    }

    /// @dev Passes a timelocked federation proposal with the votes of A and B.
    function _passWithAB(uint256 id) internal {
        _orgApprove(orgA, id);
        _orgApprove(orgB, id);
        vm.warp(registry.getProposal(id).executableAt);
        assertTrue(registry.execute(id));
    }

    function _firstAdmin(Organization org) internal view returns (address) {
        return org.getAdmins()[0];
    }

    function _status(address org) internal view returns (IIssuerRegistry.OrganizationStatus) {
        return registry.getOrganization(org).status;
    }
}
