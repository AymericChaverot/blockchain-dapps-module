import { computeCredentialId, isAddressLike, isBytes32, sha256Hex, tryParseCredentialDocument } from "@sitepass/shared";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  FileQuestionIcon,
  FileWarningIcon,
  Loader2Icon,
  PresentationIcon,
  RefreshCwIcon,
  ScanLineIcon,
  SearchIcon,
  UnplugIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { type Address, type Hex, getAddress } from "viem";

import { CredentialDetails, type DocumentAnalysis } from "@/components/CredentialDetails";
import { type DroppedFile, FileDropZone } from "@/components/FileDropZone";
import { HexValue } from "@/components/HexValue";
import { ProofRequest } from "@/components/ProofRequest";
import { StatusBadge } from "@/components/StatusBadge";
import { ScanButton } from "@/components/QrScanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type DemoSeedCredential, useDemoSeed } from "@/config/demo";
import { useAppMode } from "@/config/mode";
import { chain, contracts, isConfigured, networkLabel } from "@/config/network";
import {
  type CredentialView,
  credentialTypeInfo,
  fetchCredential,
  fetchCredentials,
  fetchHolderCredentials,
  findCredentialIdsByDocumentHash,
} from "@/lib/credentials";
import { formatDate } from "@/lib/format";
import { statusMeta } from "@/lib/credentials";

/** A sample certificate pushed to the verifier from the demo console (router state). */
export interface SampleFile {
  name: string;
  content: string;
}

/** Returns a copy of a certificate with one letter of the holder name changed. */
export function tamperCertificate(content: string): string {
  return content.replace(/("lastName":\s*")(.)/, (_match, prefix: string, first: string) =>
    prefix + (first === "X" ? "Y" : "X"),
  );
}

const encoder = new TextEncoder();

function sampleToFile(sample: SampleFile): DroppedFile {
  return { name: sample.name, bytes: encoder.encode(sample.content) };
}

/** Resolves a dropped document to the credential(s) anchoring it. */
async function resolveDocument(file: DroppedFile): Promise<{ analysis: DocumentAnalysis; ids: Hex[] }> {
  const hash = await sha256Hex(file.bytes);
  const document = tryParseCredentialDocument(file.bytes);
  const ids = new Set<Hex>(await findCredentialIdsByDocumentHash(hash));
  // A SitePass JSON carries enough to recompute the id even without the index.
  if (document && contracts.siteCredentialManager && document.anchor.chainId === chain.id) {
    ids.add(
      computeCredentialId({
        chainId: chain.id,
        manager: contracts.siteCredentialManager,
        issuer: document.issuer.address,
        documentHash: hash,
      }),
    );
  }
  return { analysis: { fileName: file.name, hash, document }, ids: [...ids] };
}

function HolderResults({ holder, onSelect }: { holder: Address; onSelect: (id: Hex) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["holder-credentials", holder],
    queryFn: () => fetchHolderCredentials(holder),
  });

  if (isLoading) return <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />;
  if (error) return <Alert variant="destructive">{(error as Error).message}</Alert>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credentials held by this wallet</CardTitle>
        <CardDescription>
          <HexValue value={holder} /> · {data?.length ?? 0} credential(s), most recent first
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {data?.length === 0 && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <FileQuestionIcon className="size-4" /> No credential was ever issued to this address.
          </p>
        )}
        {data?.map((credential) => <CredentialRow key={credential.id} credential={credential} onSelect={onSelect} />)}
      </CardContent>
    </Card>
  );
}

export function CredentialRow({ credential, onSelect }: { credential: CredentialView; onSelect: (id: Hex) => void }) {
  const type = credentialTypeInfo(credential.credentialType);
  return (
    <button
      type="button"
      onClick={() => onSelect(credential.id)}
      className="hover:bg-muted/50 hover:border-primary/30 flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{type.label}</div>
        <div className="text-muted-foreground truncate text-xs">
          {credential.issuerName} · issued {formatDate(credential.issuedAt)}
          {credential.expiresAt > 0n && ` · until ${formatDate(credential.expiresAt)}`}
        </div>
      </div>
      <StatusBadge status={credential.status} />
      <ChevronRightIcon className="text-muted-foreground size-4" />
    </button>
  );
}

export function VerifierPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const holder = params.get("holder");
  const [query, setQuery] = useState(id ?? holder ?? "");
  const [analysis, setAnalysis] = useState<DocumentAnalysis>();
  const [candidates, setCandidates] = useState<CredentialView[]>();
  const [inputError, setInputError] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const { isDemo } = useAppMode();

  const credentialQuery = useQuery({
    queryKey: ["credential", id],
    queryFn: () => fetchCredential(id as Hex),
    enabled: isConfigured && !!id && isBytes32(id),
  });

  function select(next: { id?: Hex; holder?: Address }, keepAnalysis = false) {
    if (!keepAnalysis) setAnalysis(undefined);
    setCandidates(undefined);
    setInputError(undefined);
    const search = new URLSearchParams();
    if (next.id) search.set("id", next.id);
    if (next.holder) search.set("holder", next.holder);
    setParams(search);
    setQuery(next.id ?? next.holder ?? "");
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (isBytes32(value)) select({ id: value });
    else if (isAddressLike(value)) select({ holder: getAddress(value) });
    else setInputError("Enter a credential ID (0x + 64 hex) or a worker wallet address (0x + 40 hex).");
  }

  async function onFile(file: DroppedFile) {
    setResolving(true);
    setInputError(undefined);
    try {
      const resolved = await resolveDocument(file);
      setAnalysis(resolved.analysis);
      // A credential is already displayed: just compare against it.
      if (id && credentialQuery.data?.exists) return;
      const views = (await fetchCredentials(resolved.ids)).filter((view) => view.exists);
      if (views.length === 1) select({ id: views[0].id }, true);
      else {
        setParams(new URLSearchParams());
        setCandidates(views);
      }
    } catch (error) {
      setInputError((error as Error).message);
    } finally {
      setResolving(false);
    }
  }

  /** Hashes a file and compares it with the credential on screen only. */
  async function compareOnly(file: DroppedFile) {
    setResolving(true);
    try {
      setAnalysis((await resolveDocument(file)).analysis);
    } catch (error) {
      setInputError((error as Error).message);
    } finally {
      setResolving(false);
    }
  }

  // Sample certificate sent by the demo console (router state), processed once.
  const location = useLocation();
  const navigate = useNavigate();
  const handledSample = useRef<unknown>(undefined);
  useEffect(() => {
    const state = location.state as { sample?: SampleFile } | null;
    if (!state?.sample || handledSample.current === state) return;
    handledSample.current = state;
    const file = sampleToFile(state.sample);
    navigate({ search: location.search }, { replace: true, state: null });
    if (id) void compareOnly(file);
    else void onFile(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const credential = credentialQuery.data;

  // Keep the search field in sync with links and scans.
  useEffect(() => {
    setQuery(id ?? holder ?? "");
    window.scrollTo({ top: 0 });
  }, [id, holder]);

  // After a scan, bring the verdict into view (the search card fills a phone screen).
  const resultRef = useRef<HTMLDivElement>(null);
  const revealResult = useRef(false);
  useEffect(() => {
    if (!revealResult.current || !credential) return;
    revealResult.current = false;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [credential]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <>
            <UnplugIcon className="size-3.5" /> No wallet needed
          </>
        }
        title="Verify a safety clearance"
        description={`Scan the worker's QR code to see at once whether their clearance is valid, revoked or expired, and who issued it. Reads the ${networkLabel} network directly.`}
      />

      {/* On phones the verdict comes first; the search moves below it. */}
      <Card className={id || holder || candidates ? "max-lg:order-last" : undefined}>
        <CardContent className="flex flex-col gap-4">
          <ScanButton
            className="w-full"
            title="Scan the worker's code"
            hint="The QR code shown in the worker's SitePass app or printed on their badge."
            manualPlaceholder="Credential ID or wallet address"
            onScan={(code) => {
              if (code.kind === "credential") select({ id: code.id });
              else if (code.kind === "holder") select({ holder: code.address });
              else if (code.kind === "challenge") return "This is a proof code: the worker scans it, not the verifier.";
              else return "Not a SitePass credential code.";
              revealResult.current = true;
              return true;
            }}
          >
            <ScanLineIcon /> Scan the worker's QR code
          </ScanButton>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="bg-border h-px flex-1" /> or search <span className="bg-border h-px flex-1" />
          </div>
          <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 size-4" />
              <Input
                className="pl-9 font-mono"
                placeholder="Credential ID (0x…64) or worker wallet address (0x…40)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-invalid={!!inputError}
              />
            </div>
            <Button type="submit" disabled={!isConfigured}>
              Verify
            </Button>
          </form>
          <FileDropZone onFile={onFile} compact={!!credential} />
          {resolving && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" /> Hashing and looking up the document…
            </div>
          )}
          {inputError && <p className="text-destructive text-sm">{inputError}</p>}
          {isDemo && <DemoQuickPicks onSelect={(next) => select({ id: next })} />}
        </CardContent>
      </Card>

      {candidates && (
        <Card>
          <CardHeader>
            <CardTitle>Lookup by document</CardTitle>
            <CardDescription className="break-all">
              {analysis?.fileName} · SHA-256 <code>{analysis?.hash}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {candidates.length === 0 ? (
              <Alert variant="destructive">
                <XIcon />
                <AlertTitle>Unknown document</AlertTitle>
                <AlertDescription>
                  No credential anchors this fingerprint on {networkLabel}. The file may have been altered, or it was
                  never issued.
                </AlertDescription>
              </Alert>
            ) : (
              candidates.map((view) => <CredentialRow key={view.id} credential={view} onSelect={(next) => select({ id: next }, true)} />)
            )}
          </CardContent>
        </Card>
      )}

      {holder && isAddressLike(holder) && <HolderResults holder={getAddress(holder)} onSelect={(next) => select({ id: next })} />}

      {id && (
        <Card ref={resultRef} className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Verification result</CardTitle>
            <CardDescription>Read live from the {networkLabel} contract with a free eth_call.</CardDescription>
            <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => credentialQuery.refetch()} disabled={credentialQuery.isFetching}>
                <RefreshCwIcon className={credentialQuery.isFetching ? "animate-spin" : ""} /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!isBytes32(id) && <p className="text-destructive text-sm">Invalid credential ID.</p>}
            {credentialQuery.isLoading && <Loader2Icon className="text-muted-foreground mx-auto size-6 animate-spin" />}
            {credentialQuery.error && (
              <Alert variant="destructive">
                <AlertTitle>Could not reach the network</AlertTitle>
                <AlertDescription>{(credentialQuery.error as Error).message}</AlertDescription>
              </Alert>
            )}
            {credential && <CredentialDetails credential={credential} analysis={analysis} />}
          </CardContent>
        </Card>
      )}

      {isDemo && credential?.exists && <DemoSampleActions id={credential.id} onFile={compareOnly} />}

      {credential?.exists && <ProofRequest credential={credential} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo helpers
// ---------------------------------------------------------------------------

function seedStatusLabel(credential: DemoSeedCredential) {
  if (credential.key === "already-revoked") return statusMeta(2);
  if (credential.key === "short-expiry") return statusMeta(3);
  return statusMeta(1);
}

/** Demo only: one-click verification of the seeded credentials. */
function DemoQuickPicks({ onSelect }: { onSelect: (id: Hex) => void }) {
  const { data: seed } = useDemoSeed();
  if (!seed?.credentials.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <PresentationIcon className="size-3.5" /> Seeded credentials
      </span>
      {seed.credentials.map((credential) => {
        const Icon = seedStatusLabel(credential).icon;
        return (
          <Button key={credential.id} type="button" size="sm" variant="outline" onClick={() => onSelect(credential.id)}>
            <Icon /> {credential.clearanceCode}
          </Button>
        );
      })}
    </div>
  );
}

/** Demo only: feed the authentic or a tampered certificate of the credential on screen. */
function DemoSampleActions({ id, onFile }: { id: Hex; onFile: (file: DroppedFile) => void }) {
  const { data: seed } = useDemoSeed();
  const document = seed?.credentials.find((credential) => credential.id.toLowerCase() === id.toLowerCase())?.document;
  if (!document) return null;
  return (
    <Card className="border-dashed py-4">
      <CardContent className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground mr-auto flex items-center gap-1.5 text-sm">
          <PresentationIcon className="size-4" /> Demo: present the worker's certificate
        </span>
        <Button size="sm" variant="outline" onClick={() => onFile(sampleToFile({ name: document.fileName, content: document.content }))}>
          <FileQuestionIcon /> Authentic certificate
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onFile(sampleToFile({ name: `tampered-${document.fileName}`, content: tamperCertificate(document.content) }))
          }
        >
          <FileWarningIcon /> Tampered copy
        </Button>
      </CardContent>
    </Card>
  );
}
