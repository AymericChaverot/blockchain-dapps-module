import type { CredentialDocument } from "@sitepass/shared";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  FileCheck2Icon,
  FileX2Icon,
  FingerprintIcon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Hex, isAddressEqual } from "viem";

import { HexValue } from "@/components/HexValue";
import { IssuerIdentity } from "@/components/IssuerIdentity";
import { StatusBanner } from "@/components/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { chain, explorerAddressUrl, requireContracts } from "@/config/network";
import { type CredentialView, credentialTypeInfo, revocationReasonLabel } from "@/lib/credentials";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DocumentAnalysis {
  fileName: string;
  hash: Hex;
  document?: CredentialDocument;
}

function Row({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        {icon}
        {label}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

function ValidityWindow({ credential }: { credential: CredentialView }) {
  if (credential.expiresAt === 0n) {
    return (
      <span>
        Issued {formatDate(credential.issuedAt)} · <Badge variant="secondary">No expiry</Badge>
      </span>
    );
  }
  const start = Number(credential.issuedAt);
  const end = Number(credential.expiresAt);
  const now = Date.now() / 1000;
  const progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{formatDate(credential.issuedAt)}</span>
        <span className={cn(credential.isExpired && "text-amber-600 font-medium dark:text-warning")}>
          {credential.isExpired ? "expired " : "expires "}
          {formatDateTime(credential.expiresAt)} ({relativeTime(credential.expiresAt)})
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", credential.isExpired ? "bg-warning" : "bg-success")}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2Icon className="text-success mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

/** Compares the document handed over by the worker with the on-chain anchor. */
function DocumentComparison({ credential, analysis }: { credential: CredentialView; analysis: DocumentAnalysis }) {
  const matches = analysis.hash.toLowerCase() === credential.documentHash.toLowerCase();
  const doc = analysis.document;
  const type = credentialTypeInfo(credential.credentialType);

  return (
    <div className="flex flex-col gap-3">
      <Alert variant={matches ? "success" : "destructive"}>
        {matches ? <FileCheck2Icon /> : <FileX2Icon />}
        <AlertTitle>
          {matches ? "Document authentic - SHA-256 matches the on-chain anchor" : "Document does NOT match"}
        </AlertTitle>
        <AlertDescription>
          <span className="break-all">
            <b>{analysis.fileName}</b> → <code className="text-xs">{analysis.hash}</code>
          </span>
          {!matches && <span>The file was modified or belongs to another credential.</span>}
        </AlertDescription>
      </Alert>

      {doc && matches && (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium uppercase">
              <UserIcon className="size-3.5" /> Identity in the document (off-chain)
            </div>
            <div className="text-lg font-semibold">
              {doc.credentialSubject.firstName} {doc.credentialSubject.lastName}
            </div>
            <div className="text-muted-foreground text-sm">
              Born {doc.credentialSubject.birthDate} · {doc.credentialSubject.employer}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              Compare with the worker's ID card. This data never touches the blockchain.
            </div>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            <Check ok={isAddressEqual(doc.credentialSubject.address, credential.holder)}>Holder address matches</Check>
            <Check ok={isAddressEqual(doc.issuer.address, credential.issuer)}>Issuer address matches</Check>
            <Check ok={doc.credentialSubject.clearance.code === type.code}>Clearance type matches</Check>
            <Check
              ok={
                doc.validUntil
                  ? Math.floor(new Date(doc.validUntil).getTime() / 1000) === Number(credential.expiresAt)
                  : credential.expiresAt === 0n
              }
            >
              Expiry date matches
            </Check>
            <Check
              ok={
                doc.anchor.chainId === chain.id &&
                isAddressEqual(doc.anchor.contract, requireContracts().siteCredentialManager)
              }
            >
              Anchored on this network & contract
            </Check>
          </ul>
        </div>
      )}
    </div>
  );
}

export function CredentialDetails({
  credential,
  analysis,
  children,
}: {
  credential: CredentialView;
  analysis?: DocumentAnalysis;
  children?: ReactNode;
}) {
  const type = credentialTypeInfo(credential.credentialType);

  if (!credential.exists) {
    return (
      <div className="flex flex-col gap-4">
        <StatusBanner status={0} />
        <Row label="Credential ID" icon={<FingerprintIcon className="size-3.5" />}>
          <HexValue value={credential.id} full />
        </Row>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <StatusBanner status={credential.status}>
        {credential.isRevoked && (
          <div className="mt-1 text-sm font-medium">
            Reason: {revocationReasonLabel(credential.revocationReason)} · revoked {formatDateTime(credential.revokedAt)}
          </div>
        )}
      </StatusBanner>

      {analysis && <DocumentComparison credential={credential} analysis={analysis} />}

      <div className="divide-y">
        <Row label="Clearance">
          <div className="font-semibold">{type.label}</div>
          <code className="text-muted-foreground text-xs">{type.code}</code>
        </Row>
        <Row label="Issued by">
          <IssuerIdentity
            name={credential.issuerName}
            domain={credential.issuerDomain}
            address={credential.issuer}
            active={credential.issuerActive}
          />
          <HexValue value={credential.issuer} href={explorerAddressUrl(credential.issuer)} />
        </Row>
        <Row label="Holder wallet" icon={<UserIcon className="size-3.5" />}>
          <HexValue value={credential.holder} href={explorerAddressUrl(credential.holder)} />
        </Row>
        <Row label="Validity" icon={<CalendarClockIcon className="size-3.5" />}>
          <ValidityWindow credential={credential} />
        </Row>
        {credential.isRevoked && (
          <Row label="Revocation">
            <span className="text-destructive font-medium">{revocationReasonLabel(credential.revocationReason)}</span>
            <span className="text-muted-foreground"> · {formatDateTime(credential.revokedAt)}</span>
          </Row>
        )}
        <Row label="Document SHA-256" icon={<FingerprintIcon className="size-3.5" />}>
          <HexValue value={credential.documentHash} full />
        </Row>
        <Row label="Credential ID" icon={<FingerprintIcon className="size-3.5" />}>
          <HexValue value={credential.id} full />
        </Row>
      </div>

      {children}
    </div>
  );
}
