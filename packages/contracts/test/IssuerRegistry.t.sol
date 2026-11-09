// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IssuerRegistry} from "../contracts/IssuerRegistry.sol";
import {IIssuerRegistry} from "../contracts/interfaces/IIssuerRegistry.sol";

/// @notice Unit tests of the issuer whitelist and its governance.
contract IssuerRegistryTest is Test {
    IssuerRegistry internal registry;

    address internal admin = makeAddr("registryAdmin (Safe)");
    address internal issuerA = makeAddr("Issuer A");
    address internal issuerB = makeAddr("Issuer B");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        registry = new IssuerRegistry(admin);
    }

    // ------------------------------------------------------------------
    // Governance
    // ------------------------------------------------------------------

    function test_ConstructorSetsAdmin() public view {
        assertEq(registry.owner(), admin);
    }

    function test_RevertWhen_ConstructorAdminIsZero() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new IssuerRegistry(address(0));
    }

    function test_OwnershipTransferIsTwoStep() public {
        address newAdmin = makeAddr("newSafe");

        vm.prank(admin);
        registry.transferOwnership(newAdmin);
        // Until accepted, the old admin keeps control.
        assertEq(registry.owner(), admin);
        assertEq(registry.pendingOwner(), newAdmin);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.acceptOwnership();

        vm.prank(newAdmin);
        registry.acceptOwnership();
        assertEq(registry.owner(), newAdmin);
    }

    function test_RevertWhen_RenouncingOwnership() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.RenounceOwnershipDisabled.selector);
        registry.renounceOwnership();
        assertEq(registry.owner(), admin);
    }

    // ------------------------------------------------------------------
    // addIssuer
    // ------------------------------------------------------------------

    function test_AddIssuer() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit IssuerRegistry.IssuerAdded(issuerA, "Issuer A", "issuer-a.example");

        vm.prank(admin);
        registry.addIssuer(issuerA, "Issuer A", "issuer-a.example");

        IIssuerRegistry.Issuer memory issuer = registry.getIssuer(issuerA);
        assertEq(issuer.name, "Issuer A");
        assertEq(issuer.domain, "issuer-a.example");
        assertTrue(issuer.registered);
        assertTrue(issuer.active);
        assertEq(issuer.registeredAt, block.timestamp);
        assertTrue(registry.isActiveIssuer(issuerA));
        assertEq(registry.issuerCount(), 1);
        assertEq(registry.getIssuerAccounts()[0], issuerA);
    }

    function test_RevertWhen_NonAdminAddsIssuer() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.addIssuer(attacker, "Fake Org", "fake.example");
        assertFalse(registry.isActiveIssuer(attacker));
    }

    function test_RevertWhen_AddingZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.ZeroAddress.selector);
        registry.addIssuer(address(0), "Issuer A", "issuer-a.example");
    }

    function test_RevertWhen_AddingTwice() public {
        vm.startPrank(admin);
        registry.addIssuer(issuerA, "Issuer A", "issuer-a.example");
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.IssuerAlreadyRegistered.selector, issuerA));
        registry.addIssuer(issuerA, "Issuer A bis", "issuer-a-bis.example");
        vm.stopPrank();
    }

    function test_RevertWhen_InvalidMetadata() public {
        vm.startPrank(admin);
        vm.expectRevert(IssuerRegistry.InvalidName.selector);
        registry.addIssuer(issuerA, "", "issuer-a.example");

        vm.expectRevert(IssuerRegistry.InvalidDomain.selector);
        registry.addIssuer(issuerA, "Issuer A", "");

        bytes memory longName = new bytes(101);
        vm.expectRevert(IssuerRegistry.InvalidName.selector);
        registry.addIssuer(issuerA, string(longName), "issuer-a.example");

        bytes memory longDomain = new bytes(254);
        vm.expectRevert(IssuerRegistry.InvalidDomain.selector);
        registry.addIssuer(issuerA, "Issuer A", string(longDomain));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // updateIssuer / suspendIssuer / reinstateIssuer
    // ------------------------------------------------------------------

    function test_UpdateIssuer() public {
        vm.startPrank(admin);
        registry.addIssuer(issuerA, "Issuer A", "issuer-a.example");
        vm.warp(block.timestamp + 1 days);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IssuerRegistry.IssuerUpdated(issuerA, "Issuer A Group", "issuer-a-group.example");
        registry.updateIssuer(issuerA, "Issuer A Group", "issuer-a-group.example");
        vm.stopPrank();

        IIssuerRegistry.Issuer memory issuer = registry.getIssuer(issuerA);
        assertEq(issuer.name, "Issuer A Group");
        assertEq(issuer.domain, "issuer-a-group.example");
        assertEq(issuer.updatedAt, block.timestamp);
        assertLt(issuer.registeredAt, issuer.updatedAt);
    }

    function test_RevertWhen_UpdatingUnknownIssuer() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.IssuerNotRegistered.selector, issuerB));
        registry.updateIssuer(issuerB, "Issuer B", "issuer-b.example");
    }

    function test_SuspendAndReinstateIssuer() public {
        vm.startPrank(admin);
        registry.addIssuer(issuerB, "Issuer B", "issuer-b.example");

        vm.expectEmit(true, false, false, false, address(registry));
        emit IssuerRegistry.IssuerSuspended(issuerB);
        registry.suspendIssuer(issuerB);
        assertFalse(registry.isActiveIssuer(issuerB));
        // The record is kept: suspension is not deletion.
        assertTrue(registry.getIssuer(issuerB).registered);
        assertEq(registry.getIssuer(issuerB).name, "Issuer B");

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.IssuerAlreadySuspended.selector, issuerB));
        registry.suspendIssuer(issuerB);

        vm.expectEmit(true, false, false, false, address(registry));
        emit IssuerRegistry.IssuerReinstated(issuerB);
        registry.reinstateIssuer(issuerB);
        assertTrue(registry.isActiveIssuer(issuerB));

        vm.expectRevert(abi.encodeWithSelector(IssuerRegistry.IssuerAlreadyActive.selector, issuerB));
        registry.reinstateIssuer(issuerB);
        vm.stopPrank();
    }

    function test_RevertWhen_NonAdminSuspends() public {
        vm.prank(admin);
        registry.addIssuer(issuerB, "Issuer B", "issuer-b.example");

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.suspendIssuer(issuerB);
        assertTrue(registry.isActiveIssuer(issuerB));
    }

    function test_UnknownAddressIsNotAnIssuer() public view {
        assertFalse(registry.isActiveIssuer(attacker));
        assertFalse(registry.getIssuer(attacker).registered);
    }

    function testFuzz_OnlyAdminCanAddIssuers(address caller) public {
        vm.assume(caller != admin);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
        registry.addIssuer(issuerA, "Issuer A", "issuer-a.example");
    }
}
