// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";

/// @title SiteCredentialManager
/// @notice Anchors professional safety credentials (nuclear zone access,
///         electrical clearance, work at height...) issued by accredited
///         training organizations to workers on sensitive construction sites.
///         A credential is issued BY an organization (its {Organization}
///         contract address) and SIGNED by one of its members (a person).
///
/// @dev Design notes
///      - Attestation model (lightweight EAS-style), NOT a token: a credential
///        is a record in a mapping keyed by `id`. There is no balance, no owner
///        pointer that could be re-assigned, no approval and no transfer
///        primitive. {transferCredential} only exists to fail loudly with a
///        readable error when someone tries.
///      - Privacy (GDPR): no personal data ever reaches the chain. A credential
///        only stores the holder's pseudonymous address, a credential type
///        code, timestamps and the SHA-256 fingerprint of the off-chain JSON
///        certificate. That certificate embeds a random salt so that its hash
///        cannot be brute-forced from guessable fields (name, birth date...).
///      - Revocation never deletes data: it flags the record, timestamps it and
///        stores a reason code, so the history remains auditable.
///      - Any current member of the issuing organization may revoke one of its
///        credentials, so that a credential stays revocable when the person who
///        signed it leaves the organization or loses their key.
///      - The contract has no owner and no upgrade path: the deployer keeps no
///        power once it is deployed. Trust decisions live in {IssuerRegistry},
///        which is itself governed by the organizations (no admin).
contract SiteCredentialManager {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Reason codes accepted by {revokeCredential}.
    /// @dev `NONE` (0) is reserved for "not revoked" and is rejected as input.
    enum RevocationReason {
        NONE,
        SAFETY_BREACH,
        MEDICAL_UNFIT,
        EXPIRED_EARLY,
        FRAUDULENT_ISSUANCE
    }

    /// @notice Status computed at read time by {verifyCredential}.
    /// @dev Priority order: UNKNOWN > REVOKED > EXPIRED > ISSUER_SUSPENDED > VALID.
    enum CredentialStatus {
        UNKNOWN,
        VALID,
        REVOKED,
        EXPIRED,
        ISSUER_SUSPENDED
    }

    /// @dev Storage layout of an attestation.
    struct Credential {
        address issuer; // issuing organization (Organization contract)
        uint64 issuedAt; // 0 = does not exist
        address holder;
        uint64 expiresAt; // 0 = never expires
        address signer; // member of `issuer` who issued it
        uint64 revokedAt; // 0 = not revoked
        address revokedBy; // member of `issuer` who revoked it
        RevocationReason revocationReason;
        bytes32 credentialType; // short ASCII code, e.g. "NUC-PR1-CC"
        bytes32 documentHash; // SHA-256 of the off-chain JSON certificate
    }

    /// @notice Full, self-contained answer returned to verifiers.
    struct CredentialView {
        bytes32 id;
        bool exists;
        bool isValid;
        CredentialStatus status;
        address issuer; // issuing organization
        address signer; // person who issued it
        string issuerName;
        string issuerDomain;
        bool issuerActive;
        address holder;
        bytes32 credentialType;
        bytes32 documentHash;
        uint64 issuedAt;
        uint64 expiresAt;
        bool isExpired;
        bool isRevoked;
        uint64 revokedAt;
        address revokedBy;
        uint8 revocationReason;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Federation of accredited organizations.
    IIssuerRegistry public immutable issuerRegistry;

    mapping(bytes32 id => Credential) private _credentials;
    mapping(address holder => bytes32[]) private _credentialsByHolder;
    mapping(address issuer => bytes32[]) private _credentialsByIssuer;
    mapping(address signer => bytes32[]) private _credentialsBySigner;
    mapping(bytes32 documentHash => bytes32[]) private _credentialsByDocumentHash;
    uint256 private _totalCredentials;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event CredentialIssued(
        bytes32 indexed id,
        address indexed issuer,
        address indexed holder,
        address signer,
        bytes32 credentialType,
        bytes32 documentHash,
        uint64 issuedAt,
        uint64 expiresAt
    );

    event CredentialRevoked(
        bytes32 indexed id,
        address indexed issuer,
        address indexed holder,
        address revokedBy,
        uint8 reason,
        uint64 revokedAt
    );

    // ---------------------------------------------------------------------
    // Errors (decoded by the frontend into readable messages)
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error NotAuthorizedIssuer(address account);
    error SelfIssuanceNotAllowed(address account);
    error InvalidCredentialType();
    error InvalidDocumentHash();
    error InvalidExpiration(uint64 expiresAt, uint64 currentTime);
    error CredentialAlreadyExists(bytes32 id);
    error CredentialNotFound(bytes32 id);
    error NotCredentialIssuer(bytes32 id, address caller);
    error CredentialAlreadyRevoked(bytes32 id);
    error InvalidRevocationReason(uint8 reasonCode);
    error CredentialNonTransferable(bytes32 id);

    constructor(IIssuerRegistry registry) {
        if (address(registry) == address(0)) revert ZeroAddress();
        issuerRegistry = registry;
    }

    // ---------------------------------------------------------------------
    // Issuance & revocation
    // ---------------------------------------------------------------------

    /// @notice Issues a non-transferable credential to `holder`, on behalf of
    ///         the caller's organization.
    /// @dev Only callable by a member of an ACTIVE organization. The id is
    ///      deterministic (see {computeCredentialId}) so that a verifier holding
    ///      the JSON certificate can recompute it without any index.
    /// @param holder Worker's address (pseudonymous, no personal data).
    /// @param credentialType Short ASCII code of the clearance, right-padded to bytes32.
    /// @param documentHash SHA-256 of the off-chain JSON certificate.
    /// @param expiresAt Unix timestamp after which the credential is expired, 0 for none.
    /// @return id Identifier of the new credential.
    function issueCredential(address holder, bytes32 credentialType, bytes32 documentHash, uint64 expiresAt)
        external
        returns (bytes32 id)
    {
        address org = issuerRegistry.issuingOrganizationOf(msg.sender);
        if (org == address(0)) revert NotAuthorizedIssuer(msg.sender);
        if (holder == address(0)) revert ZeroAddress();
        if (holder == msg.sender || holder == org) revert SelfIssuanceNotAllowed(msg.sender);
        if (credentialType == bytes32(0)) revert InvalidCredentialType();
        if (documentHash == bytes32(0)) revert InvalidDocumentHash();
        uint64 nowTs = uint64(block.timestamp);
        if (expiresAt != 0 && expiresAt <= nowTs) revert InvalidExpiration(expiresAt, nowTs);

        id = computeCredentialId(org, documentHash);
        if (_credentials[id].issuedAt != 0) revert CredentialAlreadyExists(id);

        _credentials[id] = Credential({
            issuer: org,
            issuedAt: nowTs,
            holder: holder,
            expiresAt: expiresAt,
            signer: msg.sender,
            revokedAt: 0,
            revokedBy: address(0),
            revocationReason: RevocationReason.NONE,
            credentialType: credentialType,
            documentHash: documentHash
        });
        _credentialsByHolder[holder].push(id);
        _credentialsByIssuer[org].push(id);
        _credentialsBySigner[msg.sender].push(id);
        _credentialsByDocumentHash[documentHash].push(id);
        unchecked {
            ++_totalCredentials;
        }

        emit CredentialIssued(id, org, holder, msg.sender, credentialType, documentHash, nowTs, expiresAt);
    }

    /// @notice Revokes a credential. The record is kept, flagged and timestamped.
    /// @dev Restricted to the current members of the issuing organization: not
    ///      another organization, not the holder, not a former member. Members
    ///      of a suspended organization can still revoke (revoking must never
    ///      be blocked).
    /// @param id Credential identifier.
    /// @param reasonCode One of {RevocationReason} except `NONE` (1..4).
    function revokeCredential(bytes32 id, uint8 reasonCode) external {
        Credential storage credential = _credentials[id];
        if (credential.issuedAt == 0) revert CredentialNotFound(id);
        if (!issuerRegistry.isMemberOf(msg.sender, credential.issuer)) revert NotCredentialIssuer(id, msg.sender);
        if (credential.revokedAt != 0) revert CredentialAlreadyRevoked(id);
        if (reasonCode == uint8(RevocationReason.NONE) || reasonCode > uint8(RevocationReason.FRAUDULENT_ISSUANCE)) {
            revert InvalidRevocationReason(reasonCode);
        }

        uint64 nowTs = uint64(block.timestamp);
        credential.revokedAt = nowTs;
        credential.revokedBy = msg.sender;
        credential.revocationReason = RevocationReason(reasonCode);

        emit CredentialRevoked(id, credential.issuer, credential.holder, msg.sender, reasonCode, nowTs);
    }

    /// @notice Credentials cannot change hands. This function exists only so
    ///         that a transfer attempt fails with an explicit, readable error.
    /// @dev It never modifies state; there is no code path that can change
    ///      `holder` after issuance.
    function transferCredential(bytes32 id, address /* to */ ) external view {
        if (_credentials[id].issuedAt == 0) revert CredentialNotFound(id);
        revert CredentialNonTransferable(id);
    }

    // ---------------------------------------------------------------------
    // Views (free: no transaction, no gas, no wallet required)
    // ---------------------------------------------------------------------

    /// @notice Returns the full state of a credential, including issuer
    ///         metadata, so that a verifier needs a single RPC call.
    function verifyCredential(bytes32 id) public view returns (CredentialView memory result) {
        Credential storage credential = _credentials[id];
        result.id = id;
        if (credential.issuedAt == 0) {
            return result; // exists = false, status = UNKNOWN
        }

        IIssuerRegistry.OrganizationInfo memory issuer = issuerRegistry.getOrganization(credential.issuer);
        bool issuerActive = issuer.status == IIssuerRegistry.OrganizationStatus.ACTIVE;
        bool isRevoked = credential.revokedAt != 0;
        bool isExpired = credential.expiresAt != 0 && block.timestamp >= credential.expiresAt;

        CredentialStatus status;
        if (isRevoked) status = CredentialStatus.REVOKED;
        else if (isExpired) status = CredentialStatus.EXPIRED;
        else if (!issuerActive) status = CredentialStatus.ISSUER_SUSPENDED;
        else status = CredentialStatus.VALID;

        result.exists = true;
        result.isValid = status == CredentialStatus.VALID;
        result.status = status;
        result.issuer = credential.issuer;
        result.signer = credential.signer;
        result.issuerName = issuer.name;
        result.issuerDomain = issuer.domain;
        result.issuerActive = issuerActive;
        result.holder = credential.holder;
        result.credentialType = credential.credentialType;
        result.documentHash = credential.documentHash;
        result.issuedAt = credential.issuedAt;
        result.expiresAt = credential.expiresAt;
        result.isExpired = isExpired;
        result.isRevoked = isRevoked;
        result.revokedAt = credential.revokedAt;
        result.revokedBy = credential.revokedBy;
        result.revocationReason = uint8(credential.revocationReason);
    }

    /// @notice Batch version of {verifyCredential} (avoids N round-trips and
    ///         does not depend on a Multicall3 deployment, e.g. on a local node).
    function verifyCredentials(bytes32[] calldata ids) external view returns (CredentialView[] memory results) {
        results = new CredentialView[](ids.length);
        for (uint256 i = 0; i < ids.length; ++i) {
            results[i] = verifyCredential(ids[i]);
        }
    }

    /// @notice Shortcut: true only if the credential exists and its status is VALID.
    function isCredentialValid(bytes32 id) external view returns (bool) {
        return verifyCredential(id).isValid;
    }

    /// @notice Every credential id ever issued to `holder` (including revoked/expired).
    function getCredentialsByHolder(address holder) external view returns (bytes32[] memory) {
        return _credentialsByHolder[holder];
    }

    /// @notice Every credential id ever issued by the organization `issuer`.
    function getCredentialsByIssuer(address issuer) external view returns (bytes32[] memory) {
        return _credentialsByIssuer[issuer];
    }

    /// @notice Every credential id ever signed by the person `signer`.
    function getCredentialsBySigner(address signer) external view returns (bytes32[] memory) {
        return _credentialsBySigner[signer];
    }

    /// @notice Credential ids anchoring a given document fingerprint (lets a
    ///         verifier find a credential from the document alone).
    function getCredentialsByDocumentHash(bytes32 documentHash) external view returns (bytes32[] memory) {
        return _credentialsByDocumentHash[documentHash];
    }

    /// @notice Total number of credentials ever issued.
    function totalCredentials() external view returns (uint256) {
        return _totalCredentials;
    }

    /// @notice Deterministic identifier of the credential the organization
    ///         `issuer` would create for `documentHash` on this deployment.
    function computeCredentialId(address issuer, bytes32 documentHash) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), issuer, documentHash));
    }
}
