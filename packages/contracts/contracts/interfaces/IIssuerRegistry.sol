// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIssuerRegistry
/// @notice Minimal read interface used by {SiteCredentialManager} to check
///         whether an address is a currently accredited training organization.
interface IIssuerRegistry {
    /// @notice Public metadata of an accredited issuer (training organization).
    /// @dev No personal data: only the legal/public name of an organization and
    ///      the domain it controls, which verifiers use to cross-check identity
    ///      (DNS TXT record `_sitepass.<domain>`).
    struct Issuer {
        string name;
        string domain;
        bool registered;
        bool active;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    /// @notice Returns true if `account` is registered AND currently active.
    function isActiveIssuer(address account) external view returns (bool);

    /// @notice Returns the full issuer record (empty struct if unknown).
    function getIssuer(address account) external view returns (Issuer memory);
}
