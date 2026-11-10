// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIssuerRegistry} from "./interfaces/IIssuerRegistry.sol";

/// @title Organization
/// @notice On-chain identity of one training organization, administered by
///         an internal M-of-N multisig of its admins.
///
/// @dev Model
///      - The address of this contract IS the organization's identity: it is
///        what the federation accredits, what the DNS TXT record points to and
///        what credentials reference as their issuer. It never changes, even
///        when the people behind it do.
///      - Two roles, held by people (wallets):
///          * admins  - govern the organization through proposals that need
///                      `threshold` approvals; they also cast the
///                      organization's vote in the federation;
///          * members - may issue credentials on behalf of the organization
///                      and revoke any credential it issued.
///        A wallet may hold both roles, but belongs to one organization only
///        (enforced by the registry once the organization is admitted).
///      - Guard rails: every proposal expires after the federation-wide
///        `proposalLifetime`. Proposals that grant power (add a member or an
///        admin, change the threshold) wait `timelockDelay` after reaching the
///        threshold. Proposals that remove power or cast a federation vote run
///        as soon as the threshold is reached (emergency path).
///      - Deployed only by {IssuerRegistry} (see `createOrganization`).
contract Organization {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Action {
        ADD_MEMBER,
        REMOVE_MEMBER,
        ADD_ADMIN,
        REMOVE_ADMIN,
        SET_THRESHOLD,
        APPROVE_FEDERATION_PROPOSAL,
        REVOKE_FEDERATION_APPROVAL
    }

    struct Proposal {
        Action action;
        address account; // ADD/REMOVE_MEMBER, ADD/REMOVE_ADMIN
        uint256 value; // SET_THRESHOLD: new threshold; *_FEDERATION_*: federation proposal id
        address proposer;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 readyAt; // when the threshold was reached, 0 if not (yet)
        bool executed;
    }

    /// @notice Self-contained view of a proposal for the web app.
    struct ProposalView {
        uint256 id;
        Action action;
        address account;
        uint256 value;
        address proposer;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 readyAt;
        uint64 executableAt; // 0 while the threshold is not reached
        bool timelocked;
        bool executed;
        bool expired;
        uint256 approvals; // approvals of current admins only
        uint256 required;
        address[] approvers;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public constant MAX_ADMINS = 20;
    uint256 public constant MAX_MEMBERS = 200;

    /// @notice Federation this organization belongs to (its deployer).
    IIssuerRegistry public immutable registry;

    /// @notice Number of admin approvals a proposal needs.
    uint256 public threshold;

    address[] private _admins;
    mapping(address => uint256) private _adminIndex; // index + 1, 0 = not an admin
    address[] private _members;
    mapping(address => uint256) private _memberIndex; // index + 1, 0 = not a member

    Proposal[] private _proposals;
    mapping(uint256 id => address[]) private _approvers;
    mapping(uint256 id => mapping(address admin => uint256)) private _approverIndex; // index + 1

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event MemberAdded(address indexed account);
    event MemberRemoved(address indexed account);
    event AdminAdded(address indexed account);
    event AdminRemoved(address indexed account);
    event ThresholdChanged(uint256 threshold);
    event ProposalCreated(
        uint256 indexed id, Action action, address indexed account, uint256 value, address indexed proposer
    );
    event ProposalApproved(uint256 indexed id, address indexed admin);
    event ApprovalRevoked(uint256 indexed id, address indexed admin);
    event ProposalReady(uint256 indexed id, uint64 executableAt);
    event ProposalExecuted(uint256 indexed id);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error NotAdmin(address account);
    error NotAffiliated(address account);
    error InvalidThreshold(uint256 threshold, uint256 adminCount);
    error TooManyAdmins();
    error TooManyMembers();
    error AlreadyAdmin(address account);
    error AlreadyMember(address account);
    error NotAMember(address account);
    error AffiliatedElsewhere(address account, address organization);
    error ProposalNotFound(uint256 id);
    error ProposalExpired(uint256 id);
    error ProposalAlreadyExecuted(uint256 id);
    error AlreadyApproved(uint256 id, address admin);
    error NotApproved(uint256 id, address admin);
    error NotEnoughApprovals(uint256 id, uint256 approvals, uint256 required);
    error TimelockActive(uint256 id, uint64 executableAt);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @dev Called by {IssuerRegistry}, which validates affiliations itself.
    constructor(address[] memory admins, uint256 threshold_, address[] memory members) {
        registry = IIssuerRegistry(msg.sender);
        if (admins.length > MAX_ADMINS) revert TooManyAdmins();
        if (members.length > MAX_MEMBERS) revert TooManyMembers();
        for (uint256 i = 0; i < admins.length; ++i) {
            _addAdmin(admins[i]);
        }
        for (uint256 i = 0; i < members.length; ++i) {
            _addMember(members[i]);
        }
        _setThreshold(threshold_);
    }

    modifier onlyAdmin() {
        if (_adminIndex[msg.sender] == 0) revert NotAdmin(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Multisig
    // ---------------------------------------------------------------------

    /// @notice Opens a proposal and approves it on behalf of the proposer.
    ///         With a 1-of-N threshold, a non-timelocked proposal runs at once.
    /// @param action What to do.
    /// @param account Target person for member/admin actions, ignored otherwise.
    /// @param value New threshold, or federation proposal id; ignored otherwise.
    function propose(Action action, address account, uint256 value) external onlyAdmin returns (uint256 id) {
        _validate(action, account, value);

        id = _proposals.length;
        uint64 nowTs = uint64(block.timestamp);
        _proposals.push(
            Proposal({
                action: action,
                account: account,
                value: value,
                proposer: msg.sender,
                createdAt: nowTs,
                expiresAt: nowTs + registry.proposalLifetime(),
                readyAt: 0,
                executed: false
            })
        );
        emit ProposalCreated(id, action, account, value, msg.sender);

        _approve(id);
    }

    /// @notice Approves a proposal. Runs it if it reaches the threshold and is not timelocked.
    function approve(uint256 id) external onlyAdmin {
        _requireOpen(id);
        _approve(id);
    }

    /// @notice Withdraws an approval given earlier.
    function revokeApproval(uint256 id) external onlyAdmin {
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

        if (_validApprovals(id) < threshold) _proposals[id].readyAt = 0;
    }

    /// @notice Executes a proposal (anyone may call).
    /// @dev If the threshold is reached but was never recorded (e.g. the
    ///      threshold was lowered meanwhile), this call starts the timelock and
    ///      returns false; call it again once the delay has elapsed.
    /// @return executed True if the proposal ran.
    function execute(uint256 id) external returns (bool executed) {
        _requireOpen(id);
        uint256 approvals = _validApprovals(id);
        if (approvals < threshold) revert NotEnoughApprovals(id, approvals, threshold);

        Proposal storage proposal = _proposals[id];
        if (proposal.readyAt == 0) {
            _markReady(id);
            if (_isTimelocked(proposal.action)) return false;
        }
        uint64 executableAt = _executableAt(proposal);
        if (block.timestamp < executableAt) revert TimelockActive(id, executableAt);

        _execute(id);
        return true;
    }

    /// @notice Lets a person drop every role they hold in this organization.
    /// @dev Exit hatch for someone added without their consent, or who left the
    ///      organization. An admin cannot leave if that would make the
    ///      threshold unreachable.
    function leave() external {
        bool admin = _adminIndex[msg.sender] != 0;
        bool member = _memberIndex[msg.sender] != 0;
        if (!admin && !member) revert NotAffiliated(msg.sender);
        if (member) _removeMember(msg.sender);
        if (admin) _removeAdmin(msg.sender);
        registry.syncAffiliation(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isAdmin(address account) public view returns (bool) {
        return _adminIndex[account] != 0;
    }

    function isMember(address account) public view returns (bool) {
        return _memberIndex[account] != 0;
    }

    /// @notice True if `account` holds any role in this organization.
    function isAffiliated(address account) external view returns (bool) {
        return isAdmin(account) || isMember(account);
    }

    function getAdmins() external view returns (address[] memory) {
        return _admins;
    }

    function getMembers() external view returns (address[] memory) {
        return _members;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function hasApproved(uint256 id, address admin) external view returns (bool) {
        return _approverIndex[id][admin] != 0;
    }

    function getProposal(uint256 id) public view returns (ProposalView memory result) {
        if (id >= _proposals.length) revert ProposalNotFound(id);
        Proposal storage proposal = _proposals[id];
        result.id = id;
        result.action = proposal.action;
        result.account = proposal.account;
        result.value = proposal.value;
        result.proposer = proposal.proposer;
        result.createdAt = proposal.createdAt;
        result.expiresAt = proposal.expiresAt;
        result.readyAt = proposal.readyAt;
        result.executableAt = proposal.readyAt == 0 ? 0 : _executableAt(proposal);
        result.timelocked = _isTimelocked(proposal.action);
        result.executed = proposal.executed;
        result.expired = !proposal.executed && block.timestamp >= proposal.expiresAt;
        result.approvals = _validApprovals(id);
        result.required = threshold;
        result.approvers = _approvers[id];
    }

    /// @notice Every proposal, oldest first (small organizations only).
    function getProposals() external view returns (ProposalView[] memory results) {
        results = new ProposalView[](_proposals.length);
        for (uint256 i = 0; i < _proposals.length; ++i) {
            results[i] = getProposal(i);
        }
    }

    // ---------------------------------------------------------------------
    // Internal: proposals
    // ---------------------------------------------------------------------

    function _approve(uint256 id) private {
        if (_approverIndex[id][msg.sender] != 0) revert AlreadyApproved(id, msg.sender);
        _approvers[id].push(msg.sender);
        _approverIndex[id][msg.sender] = _approvers[id].length;
        emit ProposalApproved(id, msg.sender);

        Proposal storage proposal = _proposals[id];
        if (proposal.readyAt == 0 && _validApprovals(id) >= threshold) {
            _markReady(id);
            if (!_isTimelocked(proposal.action)) _execute(id);
        }
    }

    function _markReady(uint256 id) private {
        Proposal storage proposal = _proposals[id];
        proposal.readyAt = uint64(block.timestamp);
        emit ProposalReady(id, _executableAt(proposal));
    }

    function _execute(uint256 id) private {
        Proposal storage proposal = _proposals[id];
        proposal.executed = true;
        // Re-validate against the current state: it may have changed since the proposal was made.
        _validate(proposal.action, proposal.account, proposal.value);

        Action action = proposal.action;
        address account = proposal.account;
        if (action == Action.ADD_MEMBER) {
            _addMember(account);
            registry.syncAffiliation(account);
        } else if (action == Action.REMOVE_MEMBER) {
            _removeMember(account);
            registry.syncAffiliation(account);
        } else if (action == Action.ADD_ADMIN) {
            _addAdmin(account);
            registry.syncAffiliation(account);
        } else if (action == Action.REMOVE_ADMIN) {
            _removeAdmin(account);
            registry.syncAffiliation(account);
        } else if (action == Action.SET_THRESHOLD) {
            _setThreshold(proposal.value);
        } else if (action == Action.APPROVE_FEDERATION_PROPOSAL) {
            registry.approve(proposal.value);
        } else {
            registry.revokeApproval(proposal.value);
        }
        emit ProposalExecuted(id);
    }

    function _validate(Action action, address account, uint256 value) private view {
        if (action == Action.ADD_MEMBER) {
            _requireJoinable(account);
            if (_memberIndex[account] != 0) revert AlreadyMember(account);
            if (_members.length >= MAX_MEMBERS) revert TooManyMembers();
        } else if (action == Action.REMOVE_MEMBER) {
            if (_memberIndex[account] == 0) revert NotAMember(account);
        } else if (action == Action.ADD_ADMIN) {
            _requireJoinable(account);
            if (_adminIndex[account] != 0) revert AlreadyAdmin(account);
            if (_admins.length >= MAX_ADMINS) revert TooManyAdmins();
        } else if (action == Action.REMOVE_ADMIN) {
            if (_adminIndex[account] == 0) revert NotAdmin(account);
            if (_admins.length - 1 < threshold) revert InvalidThreshold(threshold, _admins.length - 1);
        } else if (action == Action.SET_THRESHOLD) {
            if (value == 0 || value > _admins.length) revert InvalidThreshold(value, _admins.length);
        }
        // Federation votes are validated by the registry itself.
    }

    function _requireJoinable(address account) private view {
        if (account == address(0)) revert ZeroAddress();
        address current = registry.organizationOf(account);
        if (current != address(0) && current != address(this)) revert AffiliatedElsewhere(account, current);
    }

    function _requireOpen(uint256 id) private view {
        if (id >= _proposals.length) revert ProposalNotFound(id);
        Proposal storage proposal = _proposals[id];
        if (proposal.executed) revert ProposalAlreadyExecuted(id);
        if (block.timestamp >= proposal.expiresAt) revert ProposalExpired(id);
    }

    /// @dev Only approvals of people who are still admins count.
    function _validApprovals(uint256 id) private view returns (uint256 count) {
        address[] storage approvers = _approvers[id];
        for (uint256 i = 0; i < approvers.length; ++i) {
            if (_adminIndex[approvers[i]] != 0) ++count;
        }
    }

    function _executableAt(Proposal storage proposal) private view returns (uint64) {
        return _isTimelocked(proposal.action) ? proposal.readyAt + registry.timelockDelay() : proposal.readyAt;
    }

    /// @dev Granting power waits for the timelock; removing power and voting do not.
    function _isTimelocked(Action action) private pure returns (bool) {
        return action == Action.ADD_MEMBER || action == Action.ADD_ADMIN || action == Action.SET_THRESHOLD;
    }

    // ---------------------------------------------------------------------
    // Internal: roles
    // ---------------------------------------------------------------------

    function _addAdmin(address account) private {
        if (account == address(0)) revert ZeroAddress();
        if (_adminIndex[account] != 0) revert AlreadyAdmin(account);
        _admins.push(account);
        _adminIndex[account] = _admins.length;
        emit AdminAdded(account);
    }

    function _removeAdmin(address account) private {
        uint256 count = _admins.length - 1;
        if (count == 0 || count < threshold) revert InvalidThreshold(threshold, count);
        uint256 index = _adminIndex[account];
        address last = _admins[_admins.length - 1];
        _admins[index - 1] = last;
        _adminIndex[last] = index;
        _admins.pop();
        delete _adminIndex[account];
        emit AdminRemoved(account);
    }

    function _addMember(address account) private {
        if (account == address(0)) revert ZeroAddress();
        if (_memberIndex[account] != 0) revert AlreadyMember(account);
        _members.push(account);
        _memberIndex[account] = _members.length;
        emit MemberAdded(account);
    }

    function _removeMember(address account) private {
        uint256 index = _memberIndex[account];
        address last = _members[_members.length - 1];
        _members[index - 1] = last;
        _memberIndex[last] = index;
        _members.pop();
        delete _memberIndex[account];
        emit MemberRemoved(account);
    }

    function _setThreshold(uint256 newThreshold) private {
        if (newThreshold == 0 || newThreshold > _admins.length) revert InvalidThreshold(newThreshold, _admins.length);
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }
}
