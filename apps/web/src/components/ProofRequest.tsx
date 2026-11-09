import {
  type ProofChallenge,
  type ProofVerification,
  createProofChallenge,
  encodeChallenge,
  verifyProofSignature,
} from "@sitepass/shared";
import {
  ChevronDownIcon,
  KeyRoundIcon,
  Loader2Icon,
  RefreshCwIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  TimerIcon,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/HexValue";
import { ScanButton } from "@/components/QrScanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { chain, requireContracts } from "@/config/network";
import type { CredentialView } from "@/lib/credentials";
import { parseSignatureInput, subscribeToProofs } from "@/lib/proofChannel";
import { cn } from "@/lib/utils";

const CHECKPOINT_KEY = "sitepass.checkpoint";

function useCountdown(deadline?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : 0;
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        done ? "bg-success text-white dark:text-background" : "bg-primary/10 text-primary",
      )}
    >
      {n}
    </span>
  );
}

function ProofResult({ result }: { result: ProofVerification }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border p-4",
        result.ok ? "border-success/30 bg-success/[0.06]" : "border-destructive/30 bg-destructive/[0.06]",
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full text-white dark:text-background",
          result.ok ? "bg-success" : "bg-destructive",
        )}
      >
        {result.ok ? <ShieldCheckIcon className="size-6" /> : <ShieldXIcon className="size-6" />}
      </span>
      <div className="min-w-0">
        <div className={cn("text-lg font-semibold", result.ok ? "text-success" : "text-destructive")}>
          {result.ok ? "Identity proven" : "Proof rejected"}
        </div>
        <div className="text-foreground/75 text-sm">
          {result.ok
            ? "The person in front of you controls the wallet that holds this credential."
            : result.message}
        </div>
        {result.signer && <code className="text-muted-foreground block truncate text-xs">Signed by {result.signer}</code>}
      </div>
    </div>
  );
}

/**
 * Verifier side of "prove you hold this credential", designed for two phones
 * and no copy-paste:
 *   1. the worker scans the challenge QR shown here and signs it (no gas);
 *   2. the verifier scans the signature QR shown on the worker's phone.
 * Same browser: the signature arrives by itself.
 */
export function ProofRequest({ credential }: { credential: CredentialView }) {
  const [site, setSite] = useState(() => {
    try {
      return localStorage.getItem(CHECKPOINT_KEY) || "Site gate";
    } catch {
      return "Site gate";
    }
  });
  const [challenge, setChallenge] = useState<ProofChallenge>();
  const [signatureInput, setSignatureInput] = useState("");
  const [result, setResult] = useState<ProofVerification>();
  const remaining = useCountdown(challenge?.expiresAt);

  const link = challenge ? `${window.location.origin}/prove?c=${encodeChallenge(challenge)}` : "";

  async function verify(signatureText: string, current: ProofChallenge | undefined = challenge) {
    if (!current) return;
    const signature = parseSignatureInput(signatureText);
    if (!signature) {
      setResult({ ok: false, reason: "INVALID_SIGNATURE", message: "This is not a valid signature." });
      return;
    }
    setResult(await verifyProofSignature(current, signature));
  }

  // Auto-receive the signature when the holder signs in another tab of this browser.
  useEffect(() => {
    if (!challenge) return;
    return subscribeToProofs((message) => {
      if (message.nonce !== challenge.nonce) return;
      setSignatureInput(message.signature);
      void verify(message.signature, challenge);
    });
  }, [challenge]);

  function generate() {
    try {
      localStorage.setItem(CHECKPOINT_KEY, site);
    } catch {
      // Not remembered: no harm.
    }
    setResult(undefined);
    setSignatureInput("");
    setChallenge(
      createProofChallenge({
        chainId: chain.id,
        manager: requireContracts().siteCredentialManager,
        credentialId: credential.id,
        holder: credential.holder,
        site,
      }),
    );
  }

  const expired = !!challenge && remaining === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="text-primary size-4" /> Check that this credential belongs to the person in front of you
        </CardTitle>
        <CardDescription>
          A valid credential is not enough: the worker proves it is theirs by signing a one-time code with their phone.
          Free, no transaction.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!challenge && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="site">Checkpoint</Label>
              <Input id="site" value={site} onChange={(event) => setSite(event.target.value)} maxLength={80} />
            </div>
            <Button size="xl" onClick={generate}>
              <KeyRoundIcon /> Ask the worker to prove it
            </Button>
          </div>
        )}

        {challenge && !result?.ok && (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StepBadge n={1} />
                <span className="font-medium">The worker scans this code with their phone and signs</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className={cn("w-full max-w-64 rounded-xl border bg-white p-3", expired && "opacity-30")}>
                  <QRCodeSVG value={link} size={256} level="M" style={{ width: "100%", height: "auto" }} />
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-sm",
                    expired ? "text-destructive font-medium" : "text-muted-foreground",
                  )}
                >
                  <TimerIcon className="size-4" />
                  {expired
                    ? "Code expired"
                    : `Valid ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StepBadge n={2} />
                <span className="font-medium">Scan the code shown on the worker's phone</span>
              </div>
              <ScanButton
                className="w-full"
                title="Scan the worker's signature"
                hint="The worker's phone shows it after signing."
                manualPlaceholder="0x… signature"
                onScan={(code) => {
                  if (code.kind !== "signature") return "This is not a signature code. Scan the code shown after signing.";
                  setSignatureInput(code.signature);
                  void verify(code.signature);
                  return true;
                }}
              >
                <ScanLineIcon /> Scan the worker's signature
              </ScanButton>
              <div className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
                <Loader2Icon className="size-3.5 animate-spin" /> Waiting for the worker…
              </div>
            </div>
          </>
        )}

        {result && <ProofResult result={result} />}

        {challenge && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={generate}>
              <RefreshCwIcon /> {result?.ok ? "Check again" : "New code"}
            </Button>
          </div>
        )}

        {challenge && !result?.ok && (
          <details className="group rounded-lg border">
            <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
              <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
              No camera? Use a link instead
            </summary>
            <div className="flex flex-col gap-3 border-t p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Challenge link</span>
                <CopyButton value={link} label="Copy" />
              </div>
              <Textarea
                rows={2}
                placeholder="Paste the worker's signature (0x…)"
                value={signatureInput}
                onChange={(event) => setSignatureInput(event.target.value)}
                className="font-mono text-xs"
              />
              <Button variant="secondary" onClick={() => verify(signatureInput)} disabled={!signatureInput}>
                Verify signature
              </Button>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
