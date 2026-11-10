// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";
import {Organization} from "./Organization.sol";

/// @title IssuerRegistry
/// @notice Self-governed federation of accredited training organizations
///         allowed to issue SitePass safety credentials. There is no admin:
///         the organizations themselves vote on who joins, who is suspended
///         and how many votes a decision needs.
///
/// @dev Governance model
///      - Voters are the ACTIVE organizations. An organization votes through
///        its own {Organization} multisig, so one stolen admin key is never
///        enough to cast a vote.
///      - Any admin of an active organization may open a proposal: admit a
///        pending organization, update an organization's public name/domain,
///        suspend or reinstate it, or change the quorum. A pending
///        organization's admins may also apply for their own admission.
///      - A proposal passes with strictly more than `quorumBps` / 10 000 of
///        the eligible organizations (strict majority at 5 000, unanimity at
///        10 000). Votes are counted at execution time: votes of organizations
///        suspended meanwhile no longer count, and an organization never votes
///        on its own suspension.
///      - Every proposal expires after `proposalLifetime`. Proposals that grant
///        power (admission, reinstatement, metadata update, quorum change)
///        wait `timelockDelay` after reaching the quorum, so that anyone can
///        react; suspension is an emergency measure and runs immediately.
///      - The last active organization cannot be suspended: the federation
///        could never vote again.
///      - Organizations are created here (this contract is their factory) so
///        that the registry can trust their hooks. Founding organizations are
///        created and admitted in the constructor: the deployer keeps no power
///        whatsoever once the contract is deployed.
///      - A person (wallet) belongs to at most one admitted organization.
///      - Organizations are never deleted, only suspended, so that historical
///        credentials can still display who issued them.
contract IssuerRegistry is IIssuerRegistry {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ProposalKind {
        ADMIT,
        UPDATE,
        SUSPEND,
        REINSTATE,
        SET_QUORUM
    }

    struct Proposal {
        ProposalKind kind;
        address target; // organization concerned (address(0) for SET_QUORUM)
        uint16 quorumBps; // SET_QUORUM only
        address proposer;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 readyAt; // when the quorum was reached, 0 if not (yet)
        bool executed;
        string name; // UPDATE only
        string domain; // UPDATE only
    }

    /// @notice Self-contained view of a proposal for the web app.
    struct ProposalView {
        uint256 id;
        ProposalKind kind;
        address target;
        uint16 quorumBps;
        string name;
        string domain;
        address proposer;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 readyAt;
        uint64 executableAt; // 0 while the quorum is not reached
        bool timelocked;
        bool executed;
        bool expired;
        uint256 approvals; // approvals of currently eligible organizations only
        uint256 required;
        address[] approvers;
    }

    /// @notice Organization created and admitted at deployment.
    struct FoundingOrganization {
        string name;
        string domain;
        address[] admins;
        uint256 threshold;
        address[] members;
    }

    // ---------------------------------------------------------------------
    // Constants & parameters
    // ---------------------------------------------------------------------

    uint256 public constant MAX_DOMAIN_LENGTH = 253; // RFC 1035
    uint256 public constant MAX_NAME_LENGTH = 100;
    /// @notice Lowest quorum: strict majority. Below that, two disjoint
    ///         coalitions could pass contradictory decisions.
    uint16 public constant MIN_QUORUM_BPS = 5_000;
    /// @notice Highest quorum: unanimity of the eligible organizations.
    uint16 public constant MAX_QUORUM_BPS = 10_000;

    /// @inheritdoc IIssuerRegistry
    uint64 public immutable proposalLifetime;
    /// @inheritdoc IIssuerRegistry
    uint64 public immutable timelockDelay;
    /// @notice Current quorum, in basis points of eligible organizations.
    uint16 public quorumBps;
    /// @notice Number of organizations currently ACTIVE (= voters).
    uint256 public activeOrganizationCount;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(address org => OrganizationInfo) private _organizations;
    address[] private _organizationAccounts;
    mapping(address account => address org) private _affiliation;

    Proposal[] private _proposals;
    mapping(uint256 id => address[]) private _approvers;
    mapping(uint256 id => mapping(address org => uint256)) private _approverIndex; // index + 1

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event OrganizationCreated(address indexed org, string name, string domain, address indexed creator);
    event OrganizationAdmitted(address indexed org);
    event OrganizationUpdated(address indexed org, string name, string domain);
    event OrganizationSuspended(address indexed org);
    event OrganizationReinstated(address indexed org);
    event QuorumChanged(uint16 quorumBps);
    event AffiliationChanged(address indexed account, address indexed org);
    event ProposalCreated(uint256 indexed id, ProposalKind kind, address indexed target, address indexed proposer);
    event ProposalApproved(uint256 indexed id, address indexed org);
    event ApprovalRevoked(uint256 indexed id, address indexed org);
    event ProposalReady(uint256 indexed id, uint64 executableAt);
    event ProposalExecuted(uint256 indexed id);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidName();
    error InvalidDomain();
    error InvalidQuorum(uint16 quorumBps);
    error InvalidDurations(uint64 proposalLifetime, uint64 timelockDelay);
    error NoFoundingOrganization();
    error UnknownOrganization(address org);
    error NotAnOrganization(address caller);
    error InvalidOrganizationStatus(address org, OrganizationStatus status);
    error OrganizationNotActive(address org);
    error LastActiveOrganization(address org);
    error AlreadyAffiliated(address account, address org);
    error NotAuthorizedProposer(address account);
    error CannotVoteOnOwnSuspension(address org);
    error ProposalNotFound(uint256 id);
    error ProposalExpired(uint256 id);
    error ProposalAlreadyExecuted(uint256 id);
    error AlreadyApproved(uint256 id, address org);
    error NotApproved(uint256 id, address org);
    error NotEnoughApprovals(uint256 id, uint256 approvals, uint256 required);
    error TimelockActive(uint256 id, uint64 executableAt);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param lifetime Lifetime of every proposal, in seconds (e.g. 7 days).
    /// @param delay Timelock of power-granting proposals, in seconds (e.g. 2 days).
    ///        Must be shorter than `lifetime`.
    /// @param initialQuorumBps Initial quorum (5 000 = strict majority).
    /// @param founders Organizations admitted at deployment.
    constructor(uint64 lifetime, uint64 delay, uint16 initialQuorumBps, FoundingOrganization[] memory founders) {
        if (lifetime == 0 || delay >= lifetime) revert InvalidDurations(lifetime, delay);
        if (founders.length == 0) revert NoFoundingOrganization();
        proposalLifetime = lifetime;
        timelockDelay = delay;
        _setQuorum(initialQuorumBps);

        for (uint256 i = 0; i < founders.length; ++i) {
            FoundingOrganization memory f = founders[i];
            address org = _createOrganization(f.name, f.domain, f.admins, f.threshold, f.members);
            _admit(org);
        }
    }

    // ---------------------------------------------------------------------
    // Organizations
    // ---------------------------------------------------------------------

    /// @notice Deploys a new organization in PENDING state. Anyone may do so;
    ///         the federation then votes its admission. Its people are bound
    ///         to it (one organization per person) only once it is admitted.
    /// @return org Address of the new {Organization} contract: its permanent identity.
    function createOrganization(
        string calldata name,
        string calldata domain,
        address[] calldata admins,
        uint256 threshold,
        address[] calldata members
    ) external returns (address org) {
        org = _createOrganization(name, domain, admins, threshold, members);
    }

    /// @inheritdoc IIssuerRegistry
    function syncAffiliation(address account) external {
        OrganizationStatus status = _organizations[msg.sender].status;
        if (status == OrganizationStatus.NONE) revert NotAnOrganization(msg.sender);
        if (status == OrganizationStatus.PENDING) return; // bound at admission
        _sync(msg.sender, account);
    }

    // ---------------------------------------------------------------------
    // Federation proposals
    // ---------------------------------------------------------------------

    /// @notice Proposes to admit a PENDING organization.
    /// @dev May also be opened by an admin of the candidate organization itself.
    function proposeAdmission(address org) external returns (uint256) {
        if (!_isActiveAdmin(msg.sender) && !_isPendingAdminOf(msg.sender, org)) {
            revert NotAuthorizedProposer(msg.sender);
        }
        return _propose(ProposalKind.ADMIT, org, 0, "", "");
    }

    /// @notice Proposes to change the public name and domain of an organization.
    function proposeUpdate(address org, string calldata name, string calldata domain) external returns (uint256) {
        _requireActiveAdmin();
        return _propose(ProposalKind.UPDATE, org, 0, name, domain);
    }

    /// @notice Proposes to suspend an ACTIVE organization (runs as soon as the quorum is reached).
    function proposeSuspension(address org) external returns (uint256) {
        _requireActiveAdmin();
        return _propose(ProposalKind.SUSPEND, org, 0, "", "");
    }

    /// @notice Proposes to reinstate a SUSPENDED organization.
    function proposeReinstatement(address org) external returns (uint256) {
        _requireActiveAdmin();
        return _propose(ProposalKind.REINSTATE, org, 0, "", "");
    }

    /// @notice Proposes a new quorum, in basis points (5 000..10 000).
    function proposeQuorum(uint16 newQuorumBps) external returns (uint256) {
        _requireActiveAdmin();
        return _propose(ProposalKind.SET_QUORUM, address(0), newQuorumBps, "", "");
    }

    /// @inheritdoc IIssuerRegistry
    /// @dev Called by an ACTIVE {Organization} contract once its own admins
    ///      reached their internal threshold. Runs a non-timelocked proposal
    ///      (suspension) as soon as the quorum is reached.
    function approve(uint256 id) external {
        if (_organizations[msg.sender].status != OrganizationStatus.ACTIVE) revert OrganizationNotActive(msg.sender);
        _requireOpen(id);
        if (_approverIndex[id][msg.sender] != 0) revert AlreadyApproved(id, msg.sender);
        Proposal storage proposal = _proposals[id];
        if (proposal.kind == ProposalKind.SUSPEND && proposal.target == msg.sender) {
            revert CannotVoteOnOwnSuspension(msg.sender);
        }

        _approvers[id].push(msg.sender);
        _approverIndex[id][msg.sender] = _approvers[id].length;
        emit ProposalApproved(id, msg.sender);

        if (proposal.readyAt == 0 && _validApprovals(id) >= _requiredApprovals(id)) {
            _markReady(id);
            if (!_isTimelocked(proposal.kind)) _execute(id);
        }
    }

    /// @inheritdoc IIssuerRegistry
    function revokeApproval(uint256 id) external {
        _requireOpen(id);
        uint256 index = _approverIndex[id][msg.sender];
        if (index == 0) revert NotApproved(id, msg.sender);

        address[] storage approvers = _approvers[id];
        address last = approvers[approvers.length - 1];
        approvers[index - 1] = last;
        _approverIndex[id][last] = index;
        approvers.pop();
        delete _approverIndex[id][msg.sender];
        emit ApprovalRevoked(id, msg.sender);

        if (_validApprovals(id) < _requiredApprovals(id)) _proposals[id].readyAt = 0;
    }

    /// @notice Executes a proposal (anyone may call).
    /// @dev If the quorum is reached but was never recorded (e.g. the number
    ///      of voters dropped meanwhile), this call starts the timelock and
    ///      returns false; call it again once the delay has elapsed.
    /// @return executed True if the proposal ran.
    function execute(uint256 id) external returns (bool executed) {
        _requireOpen(id);
        uint256 approvals = _validApprovals(id);
        uint256 required = _requiredApprovals(id);
        if (approvals < required) revert NotEnoughApprovals(id, approvals, required);

        Proposal storage proposal = _proposals[id];
        if (proposal.readyAt == 0) {
            _markReady(id);
            if (_isTimelocked(proposal.kind)) return false;
        }
        uint64 executableAt = _executableAt(proposal);
        if (block.timestamp < executableAt) revert TimelockActive(id, executableAt);

        _execute(id);
        return true;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IIssuerRegistry
    function getOrganization(address org) external view returns (OrganizationInfo memory) {
        return _organizations[org];
    }

    /// @inheritdoc IIssuerRegistry
    function isActiveOrganization(address org) public view returns (bool) {
        return _organizations[org].status == OrganizationStatus.ACTIVE;
    }

    /// @notice Every organization ever created (any status), oldest first.
    function getOrganizationAccounts() external view returns (address[] memory) {
        return _organizationAccounts;
    }

    function organizationCount() external view returns (uint256) {
        return _organizationAccounts.length;
    }

    /// @inheritdoc IIssuerRegistry
    function organizationOf(address account) external view returns (address) {
        return _affiliation[account];
    }

    /// @inheritdoc IIssuerRegistry
    function issuingOrganizationOf(address account) external view returns (address) {
        address org = _affiliation[account];
        if (org == address(0) || !isActiveOrganization(org) || !Organization(org).isMember(account)) return address(0);
        return org;
    }

    /// @inheritdoc IIssuerRegistry
    function isMemberOf(address account, address org) external view returns (bool) {
        return org != address(0) && _affiliation[account] == org && Organization(org).isMember(account);
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function hasApproved(uint256 id, address org) external view returns (bool) {
        return _approverIndex[id][org] != 0;
    }

    function getProposal(uint256 id) public view returns (ProposalView memory result) {
        if (id >= _proposals.length) revert ProposalNotFound(id);
        Proposal storage proposal = _proposals[id];
        result.id = id;
        result.kind = proposal.kind;
        result.target = proposal.target;
        result.quorumBps = proposal.quorumBps;
        result.name = proposal.name;
        result.domain = proposal.domain;
        result.proposer = proposal.proposer;
        result.createdAt = proposal.createdAt;
        result.expiresAt = proposal.expiresAt;
        result.readyAt = proposal.readyAt;
        result.executableAt = proposal.readyAt == 0 ? 0 : _executableAt(proposal);
        result.timelocked = _isTimelocked(proposal.kind);
        result.executed = proposal.executed;
        result.expired = !proposal.executed && block.timestamp >= proposal.expiresAt;
        result.approvals = _validApprovals(id);
        result.required = _requiredApprovals(id);
        result.approvers = _approvers[id];
    }

    /// @notice Every proposal, oldest first.
    function getProposals() external view returns (ProposalView[] memory results) {
        results = new ProposalView[](_proposals.length);
        for (uint256 i = 0; i < _proposals.length; ++i) {
            results[i] = getProposal(i);
        }
    }

    // ---------------------------------------------------------------------
    // Internal: organizations
    // ---------------------------------------------------------------------

    function _createOrganization(
        string memory name,
        string memory domain,
        address[] memory admins,
        uint256 threshold,
        address[] memory members
    ) private returns (address org) {
        _validateMetadata(name, domain);
        org = address(new Organization(admins, threshold, members));

        uint64 nowTs = uint64(block.timestamp);
        _organizations[org] = OrganizationInfo({
            name: name,
            domain: domain,
            status: OrganizationStatus.PENDING,
            createdAt: nowTs,
            admittedAt: 0,
            updatedAt: nowTs
        });
        _organizationAccounts.push(org);
        emit OrganizationCreated(org, name, domain, msg.sender);
    }

    /// @dev Activates `org` and binds all its people to it.
    function _admit(address org) private {
        OrganizationInfo storage info = _organizations[org];
        uint64 nowTs = uint64(block.timestamp);
        info.status = OrganizationStatus.ACTIVE;
        info.admittedAt = nowTs;
        info.updatedAt = nowTs;
        ++activeOrganizationCount;

        Organization organization = Organization(org);
        address[] memory admins = organization.getAdmins();
        for (uint256 i = 0; i < admins.length; ++i) {
            _sync(org, admins[i]);
        }
        address[] memory members = organization.getMembers();
        for (uint256 i = 0; i < members.length; ++i) {
            _sync(org, members[i]);
        }
        emit OrganizationAdmitted(org);
    }

    /// @dev Binds or unbinds `account` according to its roles in `org`.
    function _sync(address org, address account) private {
        address current = _affiliation[account];
        if (Organization(org).isAffiliated(account)) {
            if (current == org) return;
            if (current != address(0)) revert AlreadyAffiliated(account, current);
            _affiliation[account] = org;
            emit AffiliationChanged(account, org);
        } else if (current == org) {
            delete _affiliation[account];
            emit AffiliationChanged(account, address(0));
        }
    }

    // ---------------------------------------------------------------------
    // Internal: proposals
    // ---------------------------------------------------------------------

    function _propose(ProposalKind kind, address target, uint16 newQuorumBps, string memory name, string memory domain)
        private
        returns (uint256 id)
    {
        _validate(kind, target, newQuorumBps, name, domain);

        id = _proposals.length;
        uint64 nowTs = uint64(block.timestamp);
        _proposals.push(
            Proposal({
                kind: kind,
                target: target,
                quorumBps: newQuorumBps,
                proposer: msg.sender,
                createdAt: nowTs,
                expiresAt: nowTs + proposalLifetime,
                readyAt: 0,
                executed: false,
                name: name,
                domain: domain
            })
        );
        emit ProposalCreated(id, kind, target, msg.sender);
    }

    function _execute(uint256 id) private {
        Proposal storage proposal = _proposals[id];
        proposal.executed = true;
        // Re-validate against the current state: it may have changed since the proposal was made.
        _validate(proposal.kind, proposal.target, proposal.quorumBps, proposal.name, proposal.domain);

        address org = proposal.target;
        ProposalKind kind = proposal.kind;
        if (kind == ProposalKind.ADMIT) {
            _admit(org);
        } else if (kind == ProposalKind.UPDATE) {
            OrganizationInfo storage info = _organizations[org];
            info.name = proposal.name;
            info.domain = proposal.domain;
            info.updatedAt = uint64(block.timestamp);
            emit OrganizationUpdated(org, proposal.name, proposal.domain);
        } else if (kind == ProposalKind.SUSPEND) {
            _organizations[org].status = OrganizationStatus.SUSPENDED;
            _organizations[org].updatedAt = uint64(block.timestamp);
            --activeOrganizationCount;
            emit OrganizationSuspended(org);
        } else if (kind == ProposalKind.REINSTATE) {
            _organizations[org].status = OrganizationStatus.ACTIVE;
            _organizations[org].updatedAt = uint64(block.timestamp);
            ++activeOrganizationCount;
            emit OrganizationReinstated(org);
        } else {
            _setQuorum(proposal.quorumBps);
        }
        emit ProposalExecuted(id);
    }

    function _validate(ProposalKind kind, address target, uint16 newQuorumBps, string memory name, string memory domain)
        private
        view
    {
        if (kind == ProposalKind.SET_QUORUM) {
            if (newQuorumBps < MIN_QUORUM_BPS || newQuorumBps > MAX_QUORUM_BPS) revert InvalidQuorum(newQuorumBps);
            return;
        }
        OrganizationStatus status = _organizations[target].status;
        if (status == OrganizationStatus.NONE) revert UnknownOrganization(target);
        if (kind == ProposalKind.ADMIT) {
            if (status != OrganizationStatus.PENDING) revert InvalidOrganizationStatus(target, status);
        } else if (kind == ProposalKind.UPDATE) {
            if (status == OrganizationStatus.PENDING) revert InvalidOrganizationStatus(target, status);
            _validateMetadata(name, domain);
        } else if (kind == ProposalKind.SUSPEND) {
            if (status != OrganizationStatus.ACTIVE) revert InvalidOrganizationStatus(target, status);
            if (activeOrganizationCount < 2) revert LastActiveOrganization(target);
        } else {
            if (status != OrganizationStatus.SUSPENDED) revert InvalidOrganizationStatus(target, status);
        }
    }

    function _requireOpen(uint256 id) private view {
        if (id >= _proposals.length) revert ProposalNotFound(id);
        Proposal storage proposal = _proposals[id];
        if (proposal.executed) revert ProposalAlreadyExecuted(id);
        if (block.timestamp >= proposal.expiresAt) revert ProposalExpired(id);
    }

    /// @dev Approvals of organizations that are still ACTIVE. (The target of a
    ///      suspension can never be among the approvers: {approve} rejects it.)
    function _validApprovals(uint256 id) private view returns (uint256 count) {
        address[] storage approvers = _approvers[id];
        for (uint256 i = 0; i < approvers.length; ++i) {
            if (_organizations[approvers[i]].status == OrganizationStatus.ACTIVE) ++count;
        }
    }

    /// @dev Strictly more than `quorumBps` of the eligible organizations, capped at all of them.
    function _requiredApprovals(uint256 id) private view returns (uint256) {
        Proposal storage proposal = _proposals[id];
        uint256 eligible = activeOrganizationCount;
        if (proposal.kind == ProposalKind.SUSPEND && isActiveOrganization(proposal.target)) --eligible;
        if (eligible == 0) return 1; // nobody can vote: unreachable on purpose
        uint256 required = (eligible * quorumBps) / MAX_QUORUM_BPS + 1;
        return required > eligible ? eligible : required;
    }

    function _markReady(uint256 id) private {
        Proposal storage proposal = _proposals[id];
        proposal.readyAt = uint64(block.timestamp);
        emit ProposalReady(id, _executableAt(proposal));
    }

    function _executableAt(Proposal storage proposal) private view returns (uint64) {
        return _isTimelocked(proposal.kind) ? proposal.readyAt + timelockDelay : proposal.readyAt;
    }

    /// @dev Suspension is the emergency path; everything else waits for the timelock.
    function _isTimelocked(ProposalKind kind) private pure returns (bool) {
        return kind != ProposalKind.SUSPEND;
    }

    function _setQuorum(uint16 newQuorumBps) private {
        if (newQuorumBps < MIN_QUORUM_BPS || newQuorumBps > MAX_QUORUM_BPS) revert InvalidQuorum(newQuorumBps);
        quorumBps = newQuorumBps;
        emit QuorumChanged(newQuorumBps);
    }

    // ---------------------------------------------------------------------
    // Internal: access
    // ---------------------------------------------------------------------

    /// @dev Admin of an ACTIVE organization.
    function _isActiveAdmin(address account) private view returns (bool) {
        address org = _affiliation[account];
        return org != address(0) && isActiveOrganization(org) && Organization(org).isAdmin(account);
    }

    function _isPendingAdminOf(address account, address org) private view returns (bool) {
        return _organizations[org].status == OrganizationStatus.PENDING && Organization(org).isAdmin(account);
    }

    function _requireActiveAdmin() private view {
        if (!_isActiveAdmin(msg.sender)) revert NotAuthorizedProposer(msg.sender);
    }

    function _validateMetadata(string memory name, string memory domain) private pure {
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0 || nameLength > MAX_NAME_LENGTH) revert InvalidName();
        uint256 domainLength = bytes(domain).length;
        if (domainLength == 0 || domainLength > MAX_DOMAIN_LENGTH) revert InvalidDomain();
    }
}
