import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Human readable explanation of every custom error of the contracts. */
const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  // SiteCredentialManager
  NotAuthorizedIssuer: "This wallet is not an accredited issuer in the SitePass registry.",
  NotCredentialIssuer: "Only the organization that issued this credential can revoke it.",
  CredentialNonTransferable: "SitePass credentials are bound to their holder and can never be transferred.",
  CredentialNotFound: "No credential exists with this identifier.",
  CredentialAlreadyRevoked: "This credential has already been revoked.",
  CredentialAlreadyExists: "This exact document has already been anchored by this issuer.",
  InvalidRevocationReason: "The revocation reason code is invalid.",
  InvalidExpiration: "The expiration date must be in the future.",
  InvalidCredentialType: "The credential type is missing.",
  InvalidDocumentHash: "The document hash is missing.",
  SelfIssuanceNotAllowed: "An issuer cannot issue a credential to its own address.",
  ZeroAddress: "The zero address is not allowed.",
  // IssuerRegistry
  OwnableUnauthorizedAccount: "Only the registry admin (multisig) can perform this action.",
  IssuerAlreadyRegistered: "This address is already registered as an issuer.",
  IssuerNotRegistered: "This address is not registered in the registry.",
  IssuerAlreadySuspended: "This issuer is already suspended.",
  IssuerAlreadyActive: "This issuer is already active.",
  InvalidName: "The issuer name is empty or too long (max 100 characters).",
  InvalidDomain: "The issuer domain is empty or too long.",
  RenounceOwnershipDisabled: "Renouncing the registry administration is disabled.",
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
      const name = revert.data?.errorName ?? revert.reason;
      if (name) {
        const args = (revert.data?.args ?? []).map((arg) => String(arg)).join(", ");
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
