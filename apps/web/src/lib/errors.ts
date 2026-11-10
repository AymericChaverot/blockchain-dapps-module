import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  type Hex,
  UserRejectedRequestError,
  decodeErrorResult,
} from "viem";

import { issuerRegistryAbi, organizationAbi, siteCredentialManagerAbi } from "@/config/abis";

/**
 * Every custom error of the three contracts. An Organization call can revert
 * with a registry error (its federation vote is forwarded to the registry),
 * which the Organization ABI alone cannot decode.
 */
const ALL_ERRORS = [...issuerRegistryAbi, ...organizationAbi, ...siteCredentialManagerAbi].filter(
  (item) => item.type === "error",
) as Abi;

/** Human readable explanation of every custom error of the contracts. */
const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  // SiteCredentialManager
  NotAuthorizedIssuer: "This wallet is not an issuing member of an accredited organization.",
  NotCredentialIssuer: "Only a current member of the organization that issued this credential can revoke it.",
  CredentialNonTransferable: "SitePass credentials are bound to their holder and can never be transferred.",
  CredentialNotFound: "No credential exists with this identifier.",
  CredentialAlreadyRevoked: "This credential has already been revoked.",
  CredentialAlreadyExists: "This exact document has already been anchored by this organization.",
  InvalidRevocationReason: "The revocation reason code is invalid.",
  InvalidExpiration: "The expiration date must be in the future.",
  InvalidCredentialType: "The credential type is missing.",
  InvalidDocumentHash: "The document hash is missing.",
  SelfIssuanceNotAllowed: "A member cannot issue a credential to their own wallet or to their organization.",
  ZeroAddress: "The zero address is not allowed.",
  // IssuerRegistry (federation governance)
  NotAuthorizedProposer: "Only an admin of an accredited organization can open a federation proposal.",
  OrganizationNotActive:
    "Only an accredited organization can vote, through its own multisig. A personal wallet or a pending/suspended organization cannot.",
  CannotVoteOnOwnSuspension: "An organization cannot vote on its own suspension.",
  LastActiveOrganization: "The last active organization cannot be suspended: nobody could vote anymore.",
  UnknownOrganization: "This address is not an organization of the federation.",
  InvalidOrganizationStatus: "The organization is not in the right state for this proposal.",
  AlreadyAffiliated: "This person already belongs to another organization (one organization per person).",
  NotAnOrganization: "Only an organization contract can do this.",
  InvalidQuorum: "The quorum must be between 50% (strict majority) and 100% (unanimity).",
  InvalidDurations: "The proposal lifetime must be longer than the timelock.",
  NoFoundingOrganization: "The federation needs at least one founding organization.",
  InvalidName: "The organization name is empty or too long (max 100 characters).",
  InvalidDomain: "The organization domain is empty or too long.",
  // Shared by the registry and the organizations (proposals)
  ProposalNotFound: "No proposal exists with this number.",
  ProposalExpired: "This proposal has expired. Open a new one.",
  ProposalAlreadyExecuted: "This proposal has already been executed.",
  AlreadyApproved: "This approval has already been given.",
  NotApproved: "There is no approval to withdraw.",
  NotEnoughApprovals: "The proposal does not have enough approvals yet.",
  TimelockActive: "The timelock is still running: execution will be possible once it is over.",
  // Organization (internal multisig)
  NotAdmin: "Only an admin of this organization can do this.",
  NotAffiliated: "This wallet holds no role in this organization.",
  NotAMember: "This person is not an issuing member of the organization.",
  AlreadyAdmin: "This person is already an admin of the organization.",
  AlreadyMember: "This person is already an issuing member of the organization.",
  AffiliatedElsewhere: "This person already belongs to another organization (one organization per person).",
  InvalidThreshold: "The threshold must be between 1 and the number of admins.",
  TooManyAdmins: "An organization can have at most 20 admins.",
  TooManyMembers: "An organization can have at most 200 issuing members.",
};

export interface DecodedError {
  title: string;
  description: string;
  /** e.g. `NotAuthorizedIssuer(0x…)` - shown verbatim during the demo. */
  raw?: string;
}

export function decodeError(error: unknown): DecodedError {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
      return { title: "Request rejected", description: "The request was rejected in the wallet." };
    }
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const decoded = revert.data ?? decodeForeignError(revert.raw);
      const name = decoded?.errorName ?? revert.reason;
      if (name) {
        const args = (decoded?.args ?? []).map((arg) => String(arg)).join(", ");
        return {
          title: `Reverted: ${name}`,
          description: CUSTOM_ERROR_MESSAGES[name] ?? revert.shortMessage,
          raw: `${name}(${args})`,
        };
      }
    }
    return { title: "Transaction failed", description: error.shortMessage };
  }
  return { title: "Unexpected error", description: error instanceof Error ? error.message : String(error) };
}

/** Decodes a revert raised by another contract than the one called. */
function decodeForeignError(raw: Hex | undefined) {
  if (!raw || raw === "0x") return undefined;
  try {
    return decodeErrorResult({ abi: ALL_ERRORS, data: raw });
  } catch {
    return undefined;
  }
}
