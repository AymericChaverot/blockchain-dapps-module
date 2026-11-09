import { decodeChallenge, proofTypedData } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  MapPinIcon,
  PenLineIcon,
  ScanLineIcon,
  TimerIcon,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { type Hex, isAddressEqual } from "viem";
import { useSignTypedData } from "wagmi";

import { ErrorAlert } from "@/components/ErrorAlert";
import { CopyButton, HexValue } from "@/components/HexValue";
import { ScanButton } from "@/components/QrScanner";
import { WalletGate } from "@/components/Wallet";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { chain } from "@/config/network";
import { categoryIcon, credentialTypeInfo, fetchCredential } from "@/lib/credentials";
import { type DecodedError, decodeError } from "@/lib/errors";
import { publishProof } from "@/lib/proofChannel";
import { scannedCodePath } from "@/lib/scan";

/** Scan button for the verifier's challenge, reused on the worker's pages. */
export function ScanChallengeButton({ className, label = "Scan the verifier's code" }: { className?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <ScanButton
      className={className}
      title="Scan the verifier's code"
      hint="The code shown on the verifier's screen at the site gate."
      manualPlaceholder="Challenge link"
      onScan={(code) => {
        if (code.kind !== "challenge") return "This is not a verifier's code. Scan the code shown at the gate.";
        navigate(scannedCodePath(code) as string);
        return true;
      }}
    >
      <ScanLineIcon /> {label}
    </ScanButton>
  );
}

function useSecondsLeft(deadline: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, deadline - now);
}

/** Holder side of the proof of control: sign the verifier's challenge (EIP-712, no gas). */
export function ProvePage() {
  const [params] = useSearchParams();
  const challenge = useMemo(() => decodeChallenge(params.get("c") ?? ""), [params]);

  if (!challenge) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <PageHeader
          eyebrow="Worker"
          title="Prove it is your credential"
          description="At the site gate, the verifier shows a code on their screen. Scan it to continue."
        />
        <ScanChallengeButton className="w-full" />
        {params.get("c") && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>This code is not valid</AlertTitle>
            <AlertDescription>Scan the code displayed by the verifier again.</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }
  return <SignChallenge key={challenge.nonce} challenge={challenge} />;
}

function SignChallenge({ challenge }: { challenge: NonNullable<ReturnType<typeof decodeChallenge>> }) {
  const { signTypedDataAsync, isPending } = useSignTypedData();
  const [signature, setSignature] = useState<Hex>();
  const [error, setError] = useState<DecodedError>();
  const remaining = useSecondsLeft(challenge.expiresAt);

  const { data: credential } = useQuery({
    queryKey: ["credential", challenge.credentialId],
    queryFn: () => fetchCredential(challenge.credentialId),
  });

  const expired = remaining === 0;
  const wrongChain = challenge.chainId !== chain.id;
  const type = credential?.exists ? credentialTypeInfo(credential.credentialType) : undefined;
  const Icon = categoryIcon(type?.category ?? "other");

  if (signature) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 text-center">
        <span className="bg-success flex size-12 items-center justify-center rounded-full text-white dark:text-background">
          <CheckCircle2Icon className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Show this code to the verifier</h1>
          <p className="text-muted-foreground mt-1 text-sm">They scan it to confirm the credential is yours.</p>
        </div>
        <div className="w-full max-w-80 rounded-2xl border bg-white p-4 shadow-sm">
          <QRCodeSVG value={signature} size={320} level="M" style={{ width: "100%", height: "auto" }} />
        </div>
        <p className="text-muted-foreground text-xs">
          If the verifier's screen is open in this same browser, it has already been updated.
        </p>
        <details className="group w-full rounded-lg border text-left">
          <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
            <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
            Show the signature as text
          </summary>
          <div className="flex flex-col gap-2 border-t p-3">
            <code className="bg-muted rounded-md p-2 text-xs break-all">{signature}</code>
            <CopyButton value={signature} label="Copy signature" />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <PageHeader
        eyebrow="Worker"
        title="Prove it is your credential"
        description="Sign with your wallet to show the verifier that this credential is yours. Free: no transaction, no gas."
      />

      <Card className="py-4">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold leading-snug">{type?.label ?? "Loading credential…"}</div>
              <div className="text-muted-foreground text-sm">{credential?.issuerName}</div>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">
            <div className="bg-muted/60 flex items-center gap-2 rounded-lg px-3 py-2">
              <MapPinIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 break-words">{challenge.site}</span>
            </div>
            <div
              className={
                expired
                  ? "bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg px-3 py-2 font-medium"
                  : "bg-muted/60 flex items-center gap-2 rounded-lg px-3 py-2"
              }
            >
              <TimerIcon className="size-4 shrink-0" />
              {expired ? "Expired" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`}
            </div>
          </div>
          <details className="group text-sm">
            <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs">
              <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" /> Technical details
            </summary>
            <dl className="mt-2 grid grid-cols-[110px_1fr] gap-1.5 text-xs">
              <dt className="text-muted-foreground">Credential ID</dt>
              <dd>
                <HexValue value={challenge.credentialId} />
              </dd>
              <dt className="text-muted-foreground">Expected wallet</dt>
              <dd>
                <HexValue value={challenge.holder} />
              </dd>
              <dt className="text-muted-foreground">Nonce</dt>
              <dd>
                <HexValue value={challenge.nonce} />
              </dd>
            </dl>
          </details>
        </CardContent>
      </Card>

      {wrongChain && (
        <Alert variant="destructive">
          <AlertTitle>This code targets chain {challenge.chainId}, but this app runs on chain {chain.id}.</AlertTitle>
        </Alert>
      )}
      {expired && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>This code has expired</AlertTitle>
          <AlertDescription>Ask the verifier for a new code and scan it again.</AlertDescription>
        </Alert>
      )}

      <WalletGate title="Connect your wallet" description="Use the wallet that received the credential.">
        {(address) => (
          <div className="flex flex-col gap-4">
            {!isAddressEqual(address, challenge.holder) && (
              <Alert variant="warning">
                <AlertTriangleIcon />
                <AlertTitle>This wallet is not the credential holder</AlertTitle>
                <AlertDescription>You can still sign, but the verifier will reject the proof.</AlertDescription>
              </Alert>
            )}
            <Button
              size="xl"
              className="w-full"
              disabled={isPending || expired || wrongChain}
              onClick={async () => {
                setError(undefined);
                try {
                  const result = await signTypedDataAsync(proofTypedData(challenge));
                  setSignature(result);
                  publishProof({ nonce: challenge.nonce, signature: result, signer: address });
                } catch (signError) {
                  setError(decodeError(signError));
                }
              }}
            >
              <PenLineIcon /> Sign
            </Button>
            {expired && <ScanChallengeButton className="w-full" label="Scan a new code" />}
            <ErrorAlert error={error} />
          </div>
        )}
      </WalletGate>
    </div>
  );
}
