import { CREDENTIAL_STATUS } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeftIcon,
  CalendarIcon,
  CopyIcon,
  ExternalLinkIcon,
  IdCardIcon,
  KeyRoundIcon,
  Loader2Icon,
  QrCodeIcon,
  SearchIcon,
  Share2Icon,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { type Address, getAddress, isAddress, isAddressEqual } from "viem";
import { useAccount } from "wagmi";

import { ErrorAlert } from "@/components/ErrorAlert";
import { HexValue } from "@/components/HexValue";
import { DnsCheckBadge } from "@/components/IssuerIdentity";
import { StatusBadge } from "@/components/StatusBadge";
import { AddressAvatar } from "@/components/Wallet";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { siteCredentialManagerAbi } from "@/config/abis";
import { useAppMode } from "@/config/mode";
import { explorerAddressUrl, isConfigured, requireContracts } from "@/config/network";
import { publicClient } from "@/config/wagmi";
import {
  type CredentialView,
  categoryIcon,
  credentialTypeInfo,
  fetchHolderCredentials,
  revocationReasonLabel,
} from "@/lib/credentials";
import { canShare, shareLink } from "@/lib/clipboard";
import { type DecodedError, decodeError } from "@/lib/errors";
import { ScanChallengeButton } from "@/pages/ProvePage";
import { formatDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function verifyLink(id: string) {
  return `${window.location.origin}/?id=${id}`;
}

/** QR code the worker shows at the gate; the verifier scans it, no wallet needed. */
function ShowToVerifierDialog({ credential }: { credential: CredentialView }) {
  const type = credentialTypeInfo(credential.credentialType);
  const Icon = categoryIcon(type.category);
  const link = verifyLink(credential.id);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="lg"
          variant={credential.status === CREDENTIAL_STATUS.VALID ? "default" : "outline"}
          className="w-full sm:w-auto"
        >
          <QrCodeIcon /> Show to verifier
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
            <Icon className="size-5" />
          </span>
          <DialogTitle className="leading-snug">{type.label}</DialogTitle>
          <DialogDescription>{credential.issuerName}</DialogDescription>
          <StatusBadge status={credential.status} />
        </DialogHeader>

        <div className="flex flex-col items-center gap-2">
          <div className="w-full max-w-72 rounded-xl border bg-white p-3 shadow-sm">
            <QRCodeSVG value={link} size={280} level="M" style={{ width: "100%", height: "auto" }} />
          </div>
          <p className="text-muted-foreground text-center text-xs">
            The verifier scans this code to check the credential live. No wallet needed.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => shareLink(link, type.label, "Verification link copied")}>
            {canShare ? <Share2Icon /> : <CopyIcon />} {canShare ? "Share" : "Copy link"}
          </Button>
          <Button variant="outline" asChild>
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> Open
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CredentialCard({
  credential,
  canTryTransfer,
  onTransferError,
}: {
  credential: CredentialView;
  canTryTransfer: boolean;
  onTransferError: (error: DecodedError) => void;
}) {
  const type = credentialTypeInfo(credential.credentialType);
  const Icon = categoryIcon(type.category);
  const [trying, setTrying] = useState(false);
  const { address } = useAccount();
  const inactive = credential.isRevoked || credential.isExpired || !credential.issuerActive;

  /**
   * Demonstrates non-transferability: the call is simulated from the holder's
   * account exactly like a wallet would before signing, and the contract
   * answers with `CredentialNonTransferable`.
   */
  async function tryTransfer() {
    setTrying(true);
    try {
      await publicClient.readContract({
        address: requireContracts().siteCredentialManager,
        abi: siteCredentialManagerAbi,
        functionName: "transferCredential",
        args: [credential.id, "0x000000000000000000000000000000000000dEaD"],
        account: address,
      });
      toast.error("Unexpected: transfer did not revert");
    } catch (error) {
      const decoded = decodeError(error);
      onTransferError(decoded);
      toast.error(decoded.title, { description: decoded.description });
    } finally {
      setTrying(false);
    }
  }

  return (
    <Card className={cn("gap-4 overflow-hidden pt-0", inactive && "opacity-90")}>
      <div className={cn("h-1", inactive ? "bg-muted-foreground/30" : "bg-primary")} />
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              inactive ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="leading-snug">{type.label}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
              {credential.issuerName}
              {credential.issuerDomain && <DnsCheckBadge domain={credential.issuerDomain} issuer={credential.issuer} />}
            </CardDescription>
          </div>
          <StatusBadge status={credential.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-sm">
        <div className="text-muted-foreground flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" />
          <span className="tabular">
            Issued {formatDate(credential.issuedAt)}
            {credential.expiresAt > 0n
              ? ` · ${credential.isExpired ? "expired" : "expires"} ${formatDate(credential.expiresAt)} (${relativeTime(credential.expiresAt)})`
              : " · no expiry"}
          </span>
        </div>
        {credential.isRevoked && (
          <div className="text-destructive font-medium">
            Revoked {formatDate(credential.revokedAt)}: {revocationReasonLabel(credential.revocationReason)}
          </div>
        )}
        <div className="text-muted-foreground text-xs">
          ID <HexValue value={credential.id} />
        </div>
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap gap-2 border-t pt-4">
        <ShowToVerifierDialog credential={credential} />
        {canTryTransfer && (
          <Button size="sm" variant="ghost" onClick={tryTransfer} disabled={trying} title="Demo: the contract refuses">
            {trying ? <Loader2Icon className="animate-spin" /> : <ArrowRightLeftIcon />} Try to transfer
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function ProveIdentityCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="text-primary size-4" /> At the site gate
        </CardTitle>
        <CardDescription>
          The verifier shows a code on their screen. Scan it, then sign with your wallet: free, no transaction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScanChallengeButton className="w-full sm:w-auto" />
      </CardContent>
    </Card>
  );
}

function LookupCard() {
  const navigate = useNavigate();
  const [lookup, setLookup] = useState("");
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            className="pl-9 font-mono"
            placeholder="0x… worker wallet address"
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
          />
        </div>
        <Button variant="outline" disabled={!isAddress(lookup.trim())} onClick={() => navigate(`/holder/${lookup.trim()}`)}>
          Open
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Worker credentials. `/wallet` shows the connected wallet's own credentials
 * (guarded), `/holder/:address` is the public, shareable page of any wallet.
 */
export function HolderPage() {
  const params = useParams();
  const { address: connected } = useAccount();
  const { isDemo } = useAppMode();
  const [transferError, setTransferError] = useState<DecodedError>();

  const target: Address | undefined =
    params.address && isAddress(params.address) ? getAddress(params.address) : connected;
  const isOwnPage = !!target && !!connected && isAddressEqual(target, connected);

  const { data, isLoading, error } = useQuery({
    queryKey: ["holder-credentials", target],
    queryFn: () => fetchHolderCredentials(target as Address),
    enabled: isConfigured && !!target,
  });

  const publicLink = target ? `${window.location.origin}/holder/${target}` : "";
  const valid = data?.filter((credential) => credential.status === CREDENTIAL_STATUS.VALID).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Worker"
        title={isOwnPage ? "My credentials" : "Worker credentials"}
        description="Every safety clearance ever issued to this wallet, including revoked and expired ones. Credentials are bound to the wallet: they cannot be sold, lent or transferred."
        actions={
          target && (
            <Button
              variant="outline"
              onClick={() => shareLink(publicLink, "SitePass credentials", "Public link copied")}
            >
              {canShare ? <Share2Icon /> : <CopyIcon />} {canShare ? "Share my credentials" : "Copy public link"}
            </Button>
          )
        }
      />

      {params.address && !isAddress(params.address) && (
        <Alert variant="destructive">
          <AlertTitle>Invalid address in the link</AlertTitle>
          <AlertDescription>Check the link you received.</AlertDescription>
        </Alert>
      )}

      {!target && <LookupCard />}

      {target && (
        <Card className="py-4">
          <CardContent className="flex flex-wrap items-center gap-3">
            <AddressAvatar address={target} className="size-10" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-muted-foreground text-xs">Wallet</span>
              <HexValue value={target} href={explorerAddressUrl(target)} />
            </div>
            {data && (
              <div className="text-muted-foreground text-sm">
                <span className="text-foreground tabular font-semibold">{valid}</span> valid of{" "}
                <span className="tabular">{data.length}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ErrorAlert error={transferError} />

      {isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load credentials</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}
      {data && data.length === 0 && (
        <EmptyState icon={<IdCardIcon />} title="No credential yet">
          No safety clearance has been issued to this wallet.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Valid credentials first: that is what a worker shows at the gate. */}
          {[...data]
            .sort(
              (a, b) =>
                Number(b.status === CREDENTIAL_STATUS.VALID) - Number(a.status === CREDENTIAL_STATUS.VALID),
            )
            .map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              canTryTransfer={isOwnPage && isDemo}
              onTransferError={setTransferError}
            />
          ))}
        </div>
      )}

      {isOwnPage && <ProveIdentityCard />}
    </div>
  );
}
