// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";

/// @title IssuerRegistry
/// @notice Whitelist of accredited training organizations (e.g. Issuer A, Issuer B)
///         allowed to issue SitePass safety credentials.
///
/// @dev Governance model
///      - A single `owner` (the "registry admin") adds, updates, suspends and
///        reinstates issuers. This account is the ROOT OF TRUST of the whole
///        system: whoever controls it decides who may issue credentials.
///      - It is designed to be a Safe multisig (e.g. 2-of-3 between the site
///        operator, the safety authority and an auditor). The deploy script
///        hands ownership over to `REGISTRY_ADMIN_ADDRESS` once seeding is done.
///      - Ownership transfers are two-step ({Ownable2Step}): the new admin must
///        call `acceptOwnership()`, so a typo cannot brick the registry.
///      - `renounceOwnership()` is disabled: an ownerless registry could never
///        suspend a compromised issuer again.
///      - Issuers are never deleted, only suspended, so that historical
///        credentials can still display who issued them.
contract IssuerRegistry is IIssuerRegistry, Ownable2Step {
    /// @notice Maximum length of a DNS name (RFC 1035).
    uint256 public constant MAX_DOMAIN_LENGTH = 253;
    /// @notice Maximum length of an issuer public name.
    uint256 public constant MAX_NAME_LENGTH = 100;

    mapping(address account => Issuer) private _issuers;
    address[] private _issuerAccounts;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event IssuerAdded(address indexed account, string name, string domain);
    event IssuerUpdated(address indexed account, string name, string domain);
    event IssuerSuspended(address indexed account);
    event IssuerReinstated(address indexed account);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidName();
    error InvalidDomain();
    error IssuerAlreadyRegistered(address account);
    error IssuerNotRegistered(address account);
    error IssuerAlreadySuspended(address account);
    error IssuerAlreadyActive(address account);
    error RenounceOwnershipDisabled();

    /// @param initialAdmin Account that administers the registry. For a
    ///        production deployment this should be a Safe multisig.
    constructor(address initialAdmin) Ownable(initialAdmin) {}

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Accredits a new training organization.
    /// @param account Address the organization will sign issuance transactions with.
    /// @param name Public name of the organization (e.g. "Issuer A").
    /// @param domain Reference domain controlled by the organization (e.g. "issuer-a.example").
    function addIssuer(address account, string calldata name, string calldata domain) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (_issuers[account].registered) revert IssuerAlreadyRegistered(account);
        _validateMetadata(name, domain);

        uint64 nowTs = uint64(block.timestamp);
        _issuers[account] = Issuer({
            name: name,
            domain: domain,
            registered: true,
            active: true,
            registeredAt: nowTs,
            updatedAt: nowTs
        });
        _issuerAccounts.push(account);

        emit IssuerAdded(account, name, domain);
    }

    /// @notice Updates the public name and/or domain of an issuer.
    function updateIssuer(address account, string calldata name, string calldata domain) external onlyOwner {
        Issuer storage issuer = _requireRegistered(account);
        _validateMetadata(name, domain);

        issuer.name = name;
        issuer.domain = domain;
        issuer.updatedAt = uint64(block.timestamp);

        emit IssuerUpdated(account, name, domain);
    }

    /// @notice Suspends an issuer: it can no longer issue credentials and the
    ///         credentials it issued are reported as `ISSUER_SUSPENDED`
    ///         (fail-closed) until it is reinstated.
    /// @dev A suspended issuer can still revoke its own credentials.
    function suspendIssuer(address account) external onlyOwner {
        Issuer storage issuer = _requireRegistered(account);
        if (!issuer.active) revert IssuerAlreadySuspended(account);

        issuer.active = false;
        issuer.updatedAt = uint64(block.timestamp);

        emit IssuerSuspended(account);
    }

    /// @notice Reinstates a previously suspended issuer.
    function reinstateIssuer(address account) external onlyOwner {
        Issuer storage issuer = _requireRegistered(account);
        if (issuer.active) revert IssuerAlreadyActive(account);

        issuer.active = true;
        issuer.updatedAt = uint64(block.timestamp);

        emit IssuerReinstated(account);
    }

    /// @notice Disabled: the registry must always have an admin able to
    ///         suspend a compromised issuer.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IIssuerRegistry
    function isActiveIssuer(address account) external view returns (bool) {
        Issuer storage issuer = _issuers[account];
        return issuer.registered && issuer.active;
    }

    /// @inheritdoc IIssuerRegistry
    function getIssuer(address account) external view returns (Issuer memory) {
        return _issuers[account];
    }

    /// @notice Lists every address ever registered (active or suspended).
    function getIssuerAccounts() external view returns (address[] memory) {
        return _issuerAccounts;
    }

    /// @notice Number of addresses ever registered.
    function issuerCount() external view returns (uint256) {
        return _issuerAccounts.length;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _requireRegistered(address account) private view returns (Issuer storage issuer) {
        issuer = _issuers[account];
        if (!issuer.registered) revert IssuerNotRegistered(account);
    }

    function _validateMetadata(string calldata name, string calldata domain) private pure {
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0 || nameLength > MAX_NAME_LENGTH) revert InvalidName();
        uint256 domainLength = bytes(domain).length;
        if (domainLength == 0 || domainLength > MAX_DOMAIN_LENGTH) revert InvalidDomain();
    }
}
