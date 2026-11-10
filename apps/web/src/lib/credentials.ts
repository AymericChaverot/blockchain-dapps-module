import {
  CREDENTIAL_STATUS,
  type CredentialStatusCode,
  decodeCredentialType,
  findClearanceType,
  revocationReasonLabel,
} from "@sitepass/shared";
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleSlashIcon,
  ClockAlertIcon,
  FlameIcon,
  HardHatIcon,
  type LucideIcon,
  RadiationIcon,
  ShieldOffIcon,
  ZapIcon,
} from "lucide-react";
import type { Address, ContractFunctionReturnType, Hex } from "viem";

import { siteCredentialManagerAbi } from "@/config/abis";
import { requireContracts } from "@/config/network";
import { publicClient } from "@/config/wagmi";

export type CredentialView = ContractFunctionReturnType<
  typeof siteCredentialManagerAbi,
  "view",
  "verifyCredential"
>;

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  variant: "success" | "danger" | "warning" | "muted" | "suspended";
  description: string;
}

export const STATUS_META: Record<CredentialStatusCode, StatusMeta> = {
  [CREDENTIAL_STATUS.VALID]: {
    label: "Valid",
    icon: CircleCheckIcon,
    variant: "success",
    description: "Issued by an accredited organization, not revoked and not expired.",
  },
  [CREDENTIAL_STATUS.REVOKED]: {
    label: "Revoked",
    icon: CircleSlashIcon,
    variant: "danger",
    description: "The issuer revoked this credential. Access must be refused.",
  },
  [CREDENTIAL_STATUS.EXPIRED]: {
    label: "Expired",
    icon: ClockAlertIcon,
    variant: "warning",
    description: "The validity period is over. The worker must renew the training.",
  },
  [CREDENTIAL_STATUS.ISSUER_SUSPENDED]: {
    label: "Issuer suspended",
    icon: ShieldOffIcon,
    variant: "suspended",
    description: "The issuing organization has lost its accreditation. Treat as invalid.",
  },
  [CREDENTIAL_STATUS.UNKNOWN]: {
    label: "Unknown",
    icon: CircleHelpIcon,
    variant: "muted",
    description: "No credential matches this identifier on this network.",
  },
};

export function statusMeta(status: number): StatusMeta {
  return STATUS_META[status as CredentialStatusCode] ?? STATUS_META[CREDENTIAL_STATUS.UNKNOWN];
}

export function credentialTypeInfo(credentialType: Hex) {
  const code = decodeCredentialType(credentialType);
  const known = findClearanceType(code);
  return { code, label: known?.label ?? code, category: known?.category ?? "other", known };
}

export { revocationReasonLabel };

// ---------------------------------------------------------------------------
// Read helpers: plain eth_call through the public RPC, no wallet involved.
// ---------------------------------------------------------------------------

export async function fetchCredential(id: Hex): Promise<CredentialView> {
  return publicClient.readContract({
    address: requireContracts().siteCredentialManager,
    abi: siteCredentialManagerAbi,
    functionName: "verifyCredential",
    args: [id],
  });
}

export async function fetchCredentials(ids: readonly Hex[]): Promise<readonly CredentialView[]> {
  if (ids.length === 0) return [];
  return publicClient.readContract({
    address: requireContracts().siteCredentialManager,
    abi: siteCredentialManagerAbi,
    functionName: "verifyCredentials",
    args: [ids],
  });
}

async function readIds(
  functionName: "getCredentialsByHolder" | "getCredentialsByIssuer" | "getCredentialsBySigner",
  account: Address,
) {
  return publicClient.readContract({
    address: requireContracts().siteCredentialManager,
    abi: siteCredentialManagerAbi,
    functionName,
    args: [account],
  });
}

/** Most recent first. */
export async function fetchHolderCredentials(holder: Address): Promise<CredentialView[]> {
  return [...(await fetchCredentials(await readIds("getCredentialsByHolder", holder)))].reverse();
}

/** Credentials issued by an organization (any of its members), most recent first. */
export async function fetchIssuerCredentials(organization: Address): Promise<CredentialView[]> {
  return [...(await fetchCredentials(await readIds("getCredentialsByIssuer", organization)))].reverse();
}

export async function findCredentialIdsByDocumentHash(documentHash: Hex): Promise<readonly Hex[]> {
  return publicClient.readContract({
    address: requireContracts().siteCredentialManager,
    abi: siteCredentialManagerAbi,
    functionName: "getCredentialsByDocumentHash",
    args: [documentHash],
  });
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  nuclear: RadiationIcon,
  electrical: ZapIcon,
  construction: HardHatIcon,
  hazardous: FlameIcon,
};

/** Icon of a clearance category (nuclear, electrical, construction, hazardous). */
export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? BadgeCheckIcon;
}
