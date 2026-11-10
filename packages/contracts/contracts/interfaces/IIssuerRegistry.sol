// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIssuerRegistry
/// @notice Interface of the federation of accredited training organizations.
///         Used by {SiteCredentialManager} (who may issue / revoke) and by
///         each {Organization} contract (affiliation sync, global votes).
interface IIssuerRegistry {
    /// @notice Lifecycle of an organization in the federation.
    /// @dev `NONE`: unknown address. `PENDING`: created, waiting for the
    ///      federation to vote its admission. `ACTIVE`: accredited, its members
    ///      may issue. `SUSPENDED`: accreditation withdrawn by vote, its
    ///      credentials are reported as `ISSUER_SUSPENDED`.
    enum OrganizationStatus {
        NONE,
        PENDING,
        ACTIVE,
        SUSPENDED
    }

    /// @notice Public metadata of an organization.
    /// @dev No personal data: only the legal/public name of an organization and
    ///      the domain it controls, which verifiers use to cross-check identity
    ///      (DNS TXT record `_sitepass.<domain>`).
    struct OrganizationInfo {
        string name;
        string domain;
        OrganizationStatus status;
        uint64 createdAt;
        uint64 admittedAt;
        uint64 updatedAt;
    }

    // ------------------------------------------------------------------
    // Reads used by SiteCredentialManager
    // ------------------------------------------------------------------

    /// @notice Full record of an organization (empty struct if unknown).
    function getOrganization(address org) external view returns (OrganizationInfo memory);

    /// @notice True if `org` is admitted and not suspended.
    function isActiveOrganization(address org) external view returns (bool);

    /// @notice Organization `account` is affiliated with (admin and/or member), or address(0).
    function organizationOf(address account) external view returns (address);

    /// @notice Organization on behalf of which `account` may issue right now
    ///         (member of an ACTIVE organization), or address(0).
    function issuingOrganizationOf(address account) external view returns (address);

    /// @notice True if `account` is currently an issuing member of `org`
    ///         (whatever the status of `org`). Used for revocation.
    function isMemberOf(address account, address org) external view returns (bool);

    // ------------------------------------------------------------------
    // Hooks used by Organization contracts
    // ------------------------------------------------------------------

    /// @notice Called by an organization after the roles of `account` changed.
    function syncAffiliation(address account) external;

    /// @notice Casts the calling organization's vote on a federation proposal.
    function approve(uint256 proposalId) external;

    /// @notice Withdraws the calling organization's vote.
    function revokeApproval(uint256 proposalId) external;

    /// @notice Lifetime of every proposal (federation and organizations).
    function proposalLifetime() external view returns (uint64);

    /// @notice Delay between reaching the threshold and executing a sensitive proposal.
    function timelockDelay() external view returns (uint64);
}
