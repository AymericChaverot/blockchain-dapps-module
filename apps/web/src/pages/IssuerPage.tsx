import {
  CLEARANCE_TYPES,
  CREDENTIAL_STATUS,
  type CredentialDocument,
  REVOCATION_REASONS,
  REVOCATION_REASON_CODES,
  type RevocationReasonCode,
  buildCredentialDocument,
  computeCredentialId,
  credentialDocumentFileName,
  encodeCredentialType,
  findClearanceType,
  randomBytes32,
  serializeCredentialDocument,
  sha256Hex,
} from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BadgeCheckIcon,
  BanIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  ClockAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileJson2Icon,
  FilePlus2Icon,
  FileStackIcon,
  FingerprintIcon,
  Loader2Icon,
  PresentationIcon,
  SearchIcon,
  SendIcon,
  UserIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { type Address, type Hex, getAddress, isAddress } from "viem";
import { useAccount } from "wagmi";

import { ErrorAlert } from "@/components/ErrorAlert";
import { HexValue } from "@/components/HexValue";
import { IssuerIdentity } from "@/components/IssuerIdentity";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState, PageHeader, StatTile } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { siteCredentialManagerAbi } from "@/config/abis";
import { useAppMode } from "@/config/mode";
import { chain, explorerAddressUrl, explorerTxUrl, isConfigured, requireContracts } from "@/config/network";
import { useContractAction } from "@/hooks/useContractAction";
import {
  type CredentialView,
  credentialTypeInfo,
  fetchCredential,
  fetchIssuer,
  fetchIssuerCredentials,
} from "@/lib/credentials";
import { addMonths, downloadTextFile, formatDate, toDateInputValue } from "@/lib/format";
import { cn } from "@/lib/utils";

function useIssuer(address: Address | undefined) {
  return useQuery({
    queryKey: ["issuer", address],
    queryFn: () => fetchIssuer(address as Address),
    enabled: isConfigured && !!address,
  });
}

/** Warning for a registered but suspended issuer (both modes). */
function SuspendedNotice({ address }: { address: Address }) {
  const { data } = useIssuer(address);
  if (!data?.registered || data.active) return null;
  return (
    <Alert variant="warning">
      <AlertTriangleIcon />
      <AlertTitle>Your organization's accreditation is suspended</AlertTitle>
      <AlertDescription>
        New issuances are rejected by the contract and your existing credentials show as "Issuer suspended" to
        verifiers. You can still revoke credentials. Contact the registry administrators.
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Issuance form
// ---------------------------------------------------------------------------

interface FormState {
  holderAddress: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  employer: string;
  clearanceCode: string;
  sessionReference: string;
  location: string;
  completedOn: string;
  result: string;
  noExpiry: boolean;
  expiresOn: string;
}

function initialForm(): FormState {
  const today = new Date();
  const type = CLEARANCE_TYPES[0];
  return {
    holderAddress: "",
    firstName: "",
    lastName: "",
    birthDate: "",
    employer: "",
    clearanceCode: type.code,
    sessionReference: `S-${today.getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
    location: "",
    completedOn: toDateInputValue(today),
    result: "Passed",
    noExpiry: false,
    expiresOn: toDateInputValue(addMonths(today, type.defaultValidityMonths)),
  };
}

/** Expiry = end of the selected day, local time (seconds precision). */
function expiryDate(form: FormState): Date | undefined {
  if (form.noExpiry || !form.expiresOn) return undefined;
  const date = new Date(`${form.expiresOn}T23:59:59`);
  date.setMilliseconds(0);
  return date;
}

interface IssuedResult {
  id: Hex;
  txHash: Hex;
  document: CredentialDocument;
  fileName: string;
  content: string;
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function FormSection({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t px-5 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2.5">
        <span className="text-primary mt-0.5 [&>svg]:size-4">{icon}</span>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="text-muted-foreground text-xs">{description}</div>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function IssueForm({ issuer, issuerName, issuerDomain }: { issuer: Address; issuerName: string; issuerDomain: string }) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [salt, setSalt] = useState<Hex>(randomBytes32);
  const [validFrom] = useState(() => {
    const now = new Date();
    now.setMilliseconds(0);
    return now;
  });
  const [preview, setPreview] = useState<{ content: string; hash: Hex }>();
  const [issued, setIssued] = useState<IssuedResult>();
  const { run, pending, lastError } = useContractAction();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const holderValid = isAddress(form.holderAddress.trim());
  const clearance = findClearanceType(form.clearanceCode);

  const document = useMemo<CredentialDocument | undefined>(() => {
    if (!holderValid || !isConfigured) return undefined;
    return buildCredentialDocument({
      chainId: chain.id,
      manager: requireContracts().siteCredentialManager,
      issuer: { address: issuer, name: issuerName || "Unregistered issuer", domain: issuerDomain || "" },
      holder: {
        address: getAddress(form.holderAddress.trim()),
        firstName: form.firstName,
        lastName: form.lastName,
        birthDate: form.birthDate,
        employer: form.employer,
      },
      clearanceCode: form.clearanceCode,
      training: {
        sessionReference: form.sessionReference,
        location: form.location,
        completedOn: form.completedOn,
        result: form.result,
      },
      validFrom,
      validUntil: expiryDate(form),
      salt,
    });
  }, [form, holderValid, issuer, issuerName, issuerDomain, salt, validFrom]);

  // Live SHA-256 preview, computed locally.
  useEffect(() => {
    let cancelled = false;
    if (!document) {
      setPreview(undefined);
      return;
    }
    const content = serializeCredentialDocument(document);
    void sha256Hex(content).then((hash) => !cancelled && setPreview({ content, hash }));
    return () => {
      cancelled = true;
    };
  }, [document]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!document || !preview) return;
    const manager = requireContracts().siteCredentialManager;
    const expiresAt = BigInt(document.validUntil ? Math.floor(new Date(document.validUntil).getTime() / 1000) : 0);

    const outcome = await run(
      {
        address: manager,
        abi: siteCredentialManagerAbi,
        functionName: "issueCredential",
        args: [document.credentialSubject.address, encodeCredentialType(form.clearanceCode), preview.hash, expiresAt],
      },
      { pending: "Issuing credential…", success: "Credential issued and anchored on-chain" },
    );
    if (!outcome) return;

    const id = computeCredentialId({ chainId: chain.id, manager, issuer, documentHash: preview.hash });
    const fileName = credentialDocumentFileName(document);
    setIssued({ id, txHash: outcome.hash, document, fileName, content: preview.content });
    downloadTextFile(fileName, preview.content);
    setSalt(randomBytes32());
  }

  if (issued) {
    const txUrl = explorerTxUrl(issued.txHash);
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader>
          <span className="bg-success/10 text-success mb-2 flex size-10 items-center justify-center rounded-lg">
            <BadgeCheckIcon className="size-5" />
          </span>
          <CardTitle className="text-lg">Credential issued</CardTitle>
          <CardDescription>
            The certificate JSON was downloaded. Hand it to the worker: it is the only place where their personal data
            lives. The blockchain only stores its SHA-256 fingerprint.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="bg-muted/50 grid gap-3 rounded-lg border p-4">
            <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Credential ID</dt>
              <dd>
                <HexValue value={issued.id} full />
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Transaction</dt>
              <dd>
                <HexValue value={issued.txHash} href={txUrl} />
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => downloadTextFile(issued.fileName, issued.content)}>
              <DownloadIcon /> Download certificate again
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/?id=${issued.id}`}>
                <SearchIcon /> Open in verifier
              </Link>
            </Button>
            {txUrl && (
              <Button variant="outline" asChild>
                <a href={txUrl} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> View event on explorer
                </a>
              </Button>
            )}
            <Button
              onClick={() => {
                setIssued(undefined);
                setForm(initialForm());
              }}
            >
              <FilePlus2Icon /> Issue another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardContent className="flex flex-col gap-5 px-0">
          <FormSection
            icon={<UserIcon />}
            title="Worker"
            description="Identity fields are written into the off-chain certificate only."
          >
            <Field id="holder" label="Wallet address" className="sm:col-span-2" hint="The credential is bound to this wallet forever.">
              <Input
                id="holder"
                className="font-mono"
                placeholder="0x…"
                value={form.holderAddress}
                onChange={(event) => set("holderAddress", event.target.value)}
                aria-invalid={form.holderAddress !== "" && !holderValid}
                required
              />
            </Field>
            <Field id="firstName" label="First name">
              <Input id="firstName" value={form.firstName} onChange={(event) => set("firstName", event.target.value)} required />
            </Field>
            <Field id="lastName" label="Last name">
              <Input id="lastName" value={form.lastName} onChange={(event) => set("lastName", event.target.value)} required />
            </Field>
            <Field id="birthDate" label="Birth date">
              <Input id="birthDate" type="date" value={form.birthDate} onChange={(event) => set("birthDate", event.target.value)} required />
            </Field>
            <Field id="employer" label="Employer">
              <Input id="employer" value={form.employer} onChange={(event) => set("employer", event.target.value)} />
            </Field>
          </FormSection>

          <FormSection icon={<BadgeCheckIcon />} title="Clearance" description="Recorded on-chain as a short code.">
            <Field id="clearance" label="Clearance type" className="sm:col-span-2" hint={clearance?.description}>
              <Select
                value={form.clearanceCode}
                onValueChange={(code) => {
                  const months = findClearanceType(code)?.defaultValidityMonths ?? 36;
                  setForm((prev) => ({
                    ...prev,
                    clearanceCode: code,
                    expiresOn: toDateInputValue(addMonths(new Date(), months)),
                  }));
                }}
              >
                <SelectTrigger id="clearance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLEARANCE_TYPES.map((type) => (
                    <SelectItem key={type.code} value={type.code}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="expiresOn" label="Expires on">
              <Input
                id="expiresOn"
                type="date"
                value={form.expiresOn}
                min={toDateInputValue(new Date())}
                disabled={form.noExpiry}
                onChange={(event) => set("expiresOn", event.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={form.noExpiry}
                onChange={(event) => set("noExpiry", event.target.checked)}
              />
              No expiration
            </label>
          </FormSection>

          <FormSection icon={<FileStackIcon />} title="Training session">
            <Field id="session" label="Session reference">
              <Input id="session" value={form.sessionReference} onChange={(event) => set("sessionReference", event.target.value)} />
            </Field>
            <Field id="location" label="Location">
              <Input id="location" value={form.location} onChange={(event) => set("location", event.target.value)} />
            </Field>
            <Field id="completedOn" label="Completed on">
              <Input id="completedOn" type="date" value={form.completedOn} onChange={(event) => set("completedOn", event.target.value)} />
            </Field>
            <Field id="result" label="Result">
              <Input id="result" value={form.result} onChange={(event) => set("result", event.target.value)} />
            </Field>
          </FormSection>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:sticky lg:top-20">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson2Icon className="text-primary size-4" /> Off-chain certificate
            </CardTitle>
            <CardDescription>sitepass.credential.v1 · a random salt prevents hash guessing</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <pre className="bg-muted max-h-64 overflow-auto rounded-md border p-3 text-[11px] leading-snug">
              {preview?.content ?? "Enter the worker's wallet address to preview the document."}
            </pre>
            <div className="text-xs">
              <div className="text-muted-foreground mb-1 flex items-center gap-1.5">
                <FingerprintIcon className="size-3.5" /> SHA-256, the only value anchored on-chain
              </div>
              <code className="break-all">{preview?.hash ?? "-"}</code>
            </div>
          </CardContent>
        </Card>
        <Button type="submit" size="lg" disabled={!preview || pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Issue credential
        </Button>
        <ErrorAlert error={lastError} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

function RevokeDialog({ credential }: { credential: CredentialView }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RevocationReasonCode>(1);
  const { run, pending, lastError, clearError } = useContractAction();

  async function revoke() {
    const outcome = await run(
      {
        address: requireContracts().siteCredentialManager,
        abi: siteCredentialManagerAbi,
        functionName: "revokeCredential",
        args: [credential.id, reason],
      },
      { pending: "Revoking credential…", success: `Credential revoked (${REVOCATION_REASONS[reason].label})` },
    );
    if (outcome) setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clearError();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={credential.isRevoked}>
          <BanIcon /> Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {credentialTypeInfo(credential.credentialType).label}</DialogTitle>
          <DialogDescription>
            Revocation is permanent. The record is kept on-chain with the reason and the date, so that verifiers can
            see why access must be refused.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {REVOCATION_REASON_CODES.map((code) => (
            <label
              key={code}
              className="has-checked:border-destructive/60 has-checked:bg-destructive/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <input
                type="radio"
                name="reason"
                className="accent-destructive mt-1"
                checked={reason === code}
                onChange={() => setReason(code)}
              />
              <div>
                <div className="font-medium">
                  {REVOCATION_REASONS[code].label}{" "}
                  <code className="text-muted-foreground text-xs">
                    {code} · {REVOCATION_REASONS[code].key}
                  </code>
                </div>
                <div className="text-muted-foreground text-sm">{REVOCATION_REASONS[code].description}</div>
              </div>
            </label>
          ))}
        </div>
        <ErrorAlert error={lastError} />
        <DialogFooter>
          <Button variant="destructive" onClick={revoke} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <BanIcon />} Confirm revocation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Demo only: revoke any credential by its id. The contract only lets the
 * original issuer do it: this is how the "another issuer tries to revoke"
 * failure is shown.
 */
function RevokeById() {
  const [value, setValue] = useState("");
  const id = /^0x[0-9a-fA-F]{64}$/.test(value.trim()) ? (value.trim() as Hex) : undefined;
  const { data: credential, isFetching } = useQuery({
    queryKey: ["credential", id],
    queryFn: () => fetchCredential(id as Hex),
    enabled: isConfigured && !!id,
  });

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PresentationIcon className="text-primary size-4" /> Revoke a credential by ID
        </CardTitle>
        <CardDescription>
          Demo tool: paste the ID of a credential issued by another organization to show that the contract refuses
          (<code>NotCredentialIssuer</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="revoke-id"
            className="font-mono"
            placeholder="0x… credential ID"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {isFetching && <Loader2Icon className="size-4 animate-spin" />}
          {credential?.exists && (
            <div className="flex items-center gap-2">
              <StatusBadge status={credential.status} />
              <RevokeDialog credential={credential} />
            </div>
          )}
        </div>
        {credential && !credential.exists && <p className="text-muted-foreground text-sm">Unknown credential.</p>}
        {credential?.exists && (
          <p className="text-muted-foreground text-xs">
            Issued by {credential.issuerName} ({credential.issuer})
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "valid" | "revoked" | "expired";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "valid", label: "Valid" },
  { value: "revoked", label: "Revoked" },
  { value: "expired", label: "Expired" },
];

function matchesFilter(credential: CredentialView, filter: StatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "valid":
      return credential.status === CREDENTIAL_STATUS.VALID;
    case "revoked":
      return credential.isRevoked;
    case "expired":
      return credential.isExpired && !credential.isRevoked;
  }
}

function CredentialsTable({ credentials }: { credentials: CredentialView[] }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();

  const rows = credentials.filter((credential) => {
    if (!matchesFilter(credential, filter)) return false;
    if (!term) return true;
    const type = credentialTypeInfo(credential.credentialType);
    return (
      credential.holder.toLowerCase().includes(term) ||
      credential.id.toLowerCase().includes(term) ||
      type.code.toLowerCase().includes(term) ||
      type.label.toLowerCase().includes(term)
    );
  });

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                "text-muted-foreground cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors",
                filter === option.value && "bg-card text-foreground shadow-sm",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            className="pl-9"
            placeholder="Search holder, ID or clearance"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
            <tr>
              <th className="px-4 py-2.5 font-medium">Clearance</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Holder</th>
              <th className="px-4 py-2.5 font-medium">Issued</th>
              <th className="px-4 py-2.5 font-medium">Expires</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                  No credential matches these filters.
                </td>
              </tr>
            )}
            {rows.map((credential) => {
              const type = credentialTypeInfo(credential.credentialType);
              return (
                <tr key={credential.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link to={`/?id=${credential.id}`} className="font-medium hover:underline">
                      {type.label}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">{type.code}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={credential.status} />
                  </td>
                  <td className="px-4 py-3">
                    <HexValue value={credential.holder} href={explorerAddressUrl(credential.holder)} />
                  </td>
                  <td className="tabular px-4 py-3 whitespace-nowrap">{formatDate(credential.issuedAt)}</td>
                  <td className="tabular px-4 py-3 whitespace-nowrap">
                    {credential.expiresAt > 0n ? formatDate(credential.expiresAt) : "No expiry"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RevokeDialog credential={credential} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function IssuerOverviewPage() {
  const { address } = useAccount();
  const { isDemo } = useAppMode();
  const { data: issuer, isLoading: loadingIssuer } = useIssuer(address);
  const { data: credentials, isLoading } = useQuery({
    queryKey: ["issuer-credentials", address],
    queryFn: () => fetchIssuerCredentials(address as Address),
    enabled: isConfigured && !!address,
  });

  if (!address) return null;
  const list = credentials ?? [];
  const count = (filter: StatusFilter) => list.filter((credential) => matchesFilter(credential, filter)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Training organization"
        title={issuer?.registered ? issuer.name : "Issuer workspace"}
        description="Issue non-transferable safety clearances to workers and revoke them when needed. Only the original issuer can revoke a credential."
        actions={
          <Button asChild>
            <Link to="/issuer/new">
              <FilePlus2Icon /> Issue a credential
            </Link>
          </Button>
        }
      />

      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          {loadingIssuer ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : issuer?.registered ? (
            <IssuerIdentity name={issuer.name} domain={issuer.domain} address={address} active={issuer.active} />
          ) : (
            <span className="font-semibold">Unregistered address</span>
          )}
          <HexValue value={address} href={explorerAddressUrl(address)} />
        </CardContent>
      </Card>

      <SuspendedNotice address={address} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Issued" value={isLoading ? "–" : list.length} icon={<FileStackIcon />} />
        <StatTile label="Valid" value={isLoading ? "–" : count("valid")} icon={<CircleCheckIcon />} tone="success" />
        <StatTile label="Revoked" value={isLoading ? "–" : count("revoked")} icon={<CircleSlashIcon />} tone="danger" />
        <StatTile label="Expired" value={isLoading ? "–" : count("expired")} icon={<ClockAlertIcon />} tone="warning" />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Issued credentials</h2>
        {isLoading ? (
          <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />
        ) : list.length === 0 ? (
          <EmptyState icon={<FileStackIcon />} title="No credential issued yet">
            Credentials you issue appear here, with their live status.
          </EmptyState>
        ) : (
          <CredentialsTable credentials={list} />
        )}
      </section>

      {isDemo && <RevokeById />}
    </div>
  );
}

export function IssuePage() {
  const { address } = useAccount();
  const { data: issuer } = useIssuer(address);
  if (!address) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/issuer">
            <ArrowLeftIcon /> Overview
          </Link>
        </Button>
      </div>
      <PageHeader
        eyebrow="Training organization"
        title="Issue a safety clearance"
        description="The transaction only carries the worker's wallet, the clearance code, the expiry date and the certificate fingerprint. Personal data stays in the certificate file handed to the worker."
      />
      <SuspendedNotice address={address} />
      <IssueForm
        key={address}
        issuer={address}
        issuerName={issuer?.name ?? ""}
        issuerDomain={issuer?.domain ?? ""}
      />
    </div>
  );
}
