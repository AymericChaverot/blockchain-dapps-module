import {
  ArrowRightIcon,
  BanIcon,
  DownloadIcon,
  EyeIcon,
  FileCheck2Icon,
  FilePlus2Icon,
  FileWarningIcon,
  GavelIcon,
  BuildingIcon,
  UsersRoundIcon,
  KeyRoundIcon,
  LandmarkIcon,
  OctagonXIcon,
  PlayIcon,
  ScanSearchIcon,
  TerminalIcon,
  UserRoundCogIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { isAddressEqual } from "viem";
import { useAccount } from "wagmi";

import { CopyButton, HexValue } from "@/components/HexValue";
import { AddressAvatar, useActAs, usePersonas } from "@/components/Wallet";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type DemoSeedCredential, LOCAL_DEMO_WALLET_AVAILABLE, type Persona, type PersonaId, useDemoSeed } from "@/config/demo";
import { useAppMode } from "@/config/mode";
import { NETWORK, explorerAddressUrl, networkLabel } from "@/config/network";
import { DEMO_CONNECTOR_ID } from "@/lib/demoWallet";
import { downloadTextFile, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tamperCertificate } from "@/pages/VerifierPage";

const PERSONA_HOME: Record<PersonaId, { to: string; label: string }> = {
  adminA1: { to: "/organization", label: "Organization" },
  adminA2: { to: "/organization", label: "Organization" },
  issuerA: { to: "/issuer", label: "Issuer workspace" },
  issuerA2: { to: "/issuer", label: "Issuer workspace" },
  adminB: { to: "/governance", label: "Governance" },
  issuerB: { to: "/issuer", label: "Issuer workspace" },
  adminC: { to: "/governance", label: "Governance" },
  holder: { to: "/wallet", label: "My credentials" },
  outsider: { to: "/issuer/new", label: "Try to issue" },
};

const EXPECTED: Record<string, { label: string; variant: "success" | "danger" | "warning" }> = {
  "valid-nuclear": { label: "Valid", variant: "success" },
  "to-revoke-live": { label: "Valid, revoke live", variant: "success" },
  "short-expiry": { label: "Expires minutes after seeding", variant: "warning" },
  "already-revoked": { label: "Revoked", variant: "danger" },
};

function PersonaCard({ persona, active, onAct }: { persona: Persona; active: boolean; onAct: () => void }) {
  const home = PERSONA_HOME[persona.id];
  return (
    <Card className={cn("gap-3 py-4", active && "border-primary/60 ring-primary/20 ring-2")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <AddressAvatar address={persona.address} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{persona.label}</span>
              {active && <Badge variant="info">Active</Badge>}
            </div>
            <div className="text-muted-foreground text-xs">
              {persona.role}
              {persona.organization && ` · ${persona.organization}`}
            </div>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{persona.description}</p>
        <HexValue value={persona.address} href={explorerAddressUrl(persona.address)} />
        <div className="mt-auto flex flex-wrap gap-2">
          {persona.builtIn ? (
            <Button size="sm" onClick={onAct} variant={active ? "secondary" : "default"}>
              <UserRoundCogIcon /> {active ? "Go to" : "Act as"} · {home.label}
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">Import this account in your browser wallet.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface Step {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  persona?: PersonaId;
  action: { label: string; run: () => void };
}

function ScenarioStep({ index, step, personas }: { index: number; step: Step; personas: Persona[] }) {
  const persona = personas.find((candidate) => candidate.id === step.persona);
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {index + 1}
        </span>
        <span className="bg-border mt-2 w-px flex-1" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-primary [&>svg]:size-4">{step.icon}</span>
          <span className="font-semibold">{step.title}</span>
          {persona ? (
            <Badge variant="muted">
              <UserRoundCogIcon /> {persona.label}
            </Badge>
          ) : (
            <Badge variant="muted">
              <EyeIcon /> No wallet
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground text-sm">{step.description}</div>
        <div>
          <Button size="sm" variant="outline" onClick={step.action.run}>
            <PlayIcon /> {step.action.label}
          </Button>
        </div>
      </div>
    </li>
  );
}

function SeededCredentials({ credentials }: { credentials: DemoSeedCredential[] }) {
  const navigate = useNavigate();
  return (
    <Card className="py-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
            <tr>
              <th className="px-4 py-2.5 font-medium">Scenario</th>
              <th className="px-4 py-2.5 font-medium">Expected</th>
              <th className="px-4 py-2.5 font-medium">Credential ID</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {credentials.map((credential) => {
              const expected = EXPECTED[credential.key];
              const document = credential.document;
              return (
                <tr key={credential.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{credential.clearanceCode}</div>
                    <div className="text-muted-foreground text-xs">{credential.scenario}</div>
                  </td>
                  <td className="px-4 py-3">
                    {expected ? <Badge variant={expected.variant}>{expected.label}</Badge> : <Badge variant="muted">-</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <HexValue value={credential.id} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/?id=${credential.id}`)}>
                        <ScanSearchIcon /> Verify
                      </Button>
                      {document && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Verify from the certificate only"
                            onClick={() => navigate("/", { state: { sample: { name: document.fileName, content: document.content } } })}
                          >
                            <FileCheck2Icon /> Certificate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Present a tampered copy"
                            onClick={() =>
                              navigate(`/?id=${credential.id}`, {
                                state: {
                                  sample: { name: `tampered-${document.fileName}`, content: tamperCertificate(document.content) },
                                },
                              })
                            }
                          >
                            <FileWarningIcon /> Tampered
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Download the certificate"
                            onClick={() => downloadTextFile(document.fileName, document.content)}
                          >
                            <DownloadIcon />
                          </Button>
                        </>
                      )}
                    </div>
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

const COMMANDS = [
  { command: `pnpm demo:failures:${NETWORK === "baseSepolia" ? "base-sepolia" : "local"}`, label: "Decoded revert reasons of the failure cases" },
  { command: `pnpm seed:${NETWORK === "baseSepolia" ? "base-sepolia" : "local"}`, label: "Issue a fresh set of demo credentials" },
  { command: "pnpm test", label: "Contract test suite" },
  { command: "pnpm coverage", label: "Coverage report" },
];

export function DemoPage() {
  const navigate = useNavigate();
  const { setPreviewProduction } = useAppMode();
  const { data: seed, isLoading } = useDemoSeed();
  const personas = usePersonas();
  const actAs = useActAs();
  const { address, connector } = useAccount();

  const activeId =
    connector?.id === DEMO_CONNECTOR_ID && address
      ? personas.find((persona) => isAddressEqual(persona.address, address))?.id
      : undefined;
  const byKey = (key: string) => seed?.credentials.find((credential) => credential.key === key);

  async function go(personaId: PersonaId | undefined, to: string, state?: unknown) {
    const persona = personas.find((candidate) => candidate.id === personaId);
    if (persona?.builtIn) await actAs(persona);
    navigate(to, { state });
  }

  const valid = byKey("valid-nuclear");
  const toRevoke = byKey("to-revoke-live");

  const steps: Step[] = [
    {
      title: "No admin: a federation",
      icon: <LandmarkIcon />,
      description:
        "Public list of accredited organizations, each one a contract run by its people (admins + issuing members), with their domain cross-check. Nobody owns the registry.",
      action: { label: "Open accredited organizations", run: () => navigate("/issuers") },
    },
    {
      title: "An organization is a multisig of people",
      icon: <UsersRoundIcon />,
      persona: "adminA1",
      description:
        "Admin A1 proposes to add a trainer to the first organization: nothing happens until Admin A2 co-signs, then the timelock runs. Removing a person runs at once.",
      action: { label: "Open the organization as Admin A1", run: () => go("adminA1", "/organization") },
    },
    {
      title: "Issue a credential",
      icon: <FilePlus2Icon />,
      persona: "issuerA",
      description: `Fill in the form for the worker ${personas.find((persona) => persona.id === "holder")?.address ?? ""}. Only the SHA-256 of the certificate goes on-chain.`,
      action: { label: "Open the issuance form", run: () => go("issuerA", "/issuer/new") },
    },
    {
      title: "Verify without a wallet",
      icon: <ScanSearchIcon />,
      description: "Live status, issuer identity and validity window, read with a free eth_call.",
      action: { label: "Verify the seeded valid credential", run: () => navigate(valid ? `/?id=${valid.id}` : "/") },
    },
    {
      title: "Authentic vs tampered certificate",
      icon: <FileWarningIcon />,
      description: "The verifier hashes the certificate locally; a single changed letter breaks the match.",
      action: {
        label: "Present a tampered copy",
        run: () =>
          valid?.document
            ? navigate(`/?id=${valid.id}`, {
                state: {
                  sample: { name: `tampered-${valid.document.fileName}`, content: tamperCertificate(valid.document.content) },
                },
              })
            : navigate("/"),
      },
    },
    {
      title: "Proof of control",
      icon: <KeyRoundIcon />,
      persona: "holder",
      description:
        "Generate a challenge on the verification result, open the link: the worker signs it (EIP-712, no gas) and the verifier screen updates by itself.",
      action: { label: "Open the valid credential", run: () => navigate(valid ? `/?id=${valid.id}` : "/") },
    },
    {
      title: "Live revocation by a colleague",
      icon: <BanIcon />,
      persona: "issuerA2",
      description: `Trainer A signed ${toRevoke?.clearanceCode ?? "the to-revoke credential"}; Trainer A2, from the same organization, revokes it with a reason. Verify it again: revoked, nothing deleted, signer and revoker both recorded.`,
      action: { label: "Open the workspace as Trainer A2", run: () => go("issuerA2", "/issuer") },
    },
    {
      title: "Suspend an organization by vote",
      icon: <GavelIcon />,
      persona: "adminA1",
      description:
        "Open a suspension of the second organization. Its own vote does not count, so the first organization decides alone: Admin A1 votes, Admin A2 co-signs, the suspension runs at once and its credentials show “Issuer suspended”.",
      action: { label: "Open governance as Admin A1", run: () => go("adminA1", "/governance") },
    },
    {
      title: "Admit a new organization",
      icon: <BuildingIcon />,
      persona: "adminC",
      description:
        "Admin C creates an organization and applies for admission; the accredited organizations vote, then anyone executes after the timelock (60 s on the local chain).",
      action: { label: "Open governance as Admin C", run: () => go("adminC", "/governance") },
    },
    {
      title: "Failure: non-issuer issues",
      icon: <OctagonXIcon />,
      persona: "outsider",
      description: "The page stays open in demo mode; the contract answers NotAuthorizedIssuer.",
      action: { label: "Try to issue as an outsider", run: () => go("outsider", "/issuer/new") },
    },
    {
      title: "Failure: another organization revokes",
      icon: <OctagonXIcon />,
      persona: "issuerB",
      description: "Paste the ID of a credential issued by the first organization in “Revoke a credential by ID”: NotCredentialIssuer.",
      action: { label: "Open as Trainer B", run: () => go("issuerB", "/issuer") },
    },
    {
      title: "Failure: the worker transfers",
      icon: <OctagonXIcon />,
      persona: "holder",
      description: "“Try to transfer” on any credential: CredentialNonTransferable. There is no transfer surface at all.",
      action: { label: "Open the worker's credentials", run: () => go("holder", "/wallet") },
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Demo"
        title="Demo console"
        description={`Everything needed to present SitePass on ${networkLabel}: personas, a guided scenario and the seeded credentials with their certificates.`}
        actions={
          <Button variant="outline" onClick={() => setPreviewProduction(true)}>
            <EyeIcon /> Preview production experience
          </Button>
        }
      />

      {!LOCAL_DEMO_WALLET_AVAILABLE && (
        <Alert variant="info">
          <UserRoundCogIcon />
          <AlertTitle>Personas use your browser wallet on {networkLabel}</AlertTitle>
          <AlertDescription>
            The built-in demo wallet only exists on the local chain. Import the issuer and worker keys from the root{" "}
            <code>.env</code> in MetaMask and switch account there.
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Personas</h2>
          <p className="text-muted-foreground text-sm">
            {LOCAL_DEMO_WALLET_AVAILABLE
              ? "One click switches the built-in wallet. Transactions are real, signed locally with Hardhat's public test keys."
              : "The actors created by the seed script."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {personas.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              active={activeId === persona.id}
              onAct={() => go(persona.id, PERSONA_HOME[persona.id].to)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Seeded credentials</h2>
          <p className="text-muted-foreground text-sm">
            {seed?.seededAt ? `Seeded ${formatDateTime(Math.floor(new Date(seed.seededAt).getTime() / 1000))}.` : ""} Issued to
            the worker persona by the seed script.
          </p>
        </div>
        {isLoading ? null : seed?.credentials.length ? (
          <SeededCredentials credentials={seed.credentials} />
        ) : (
          <EmptyState icon={<FilePlus2Icon />} title="No demo data for this network">
            Run <code>pnpm deploy:local</code> or <code>pnpm seed:local</code> to create the demo credentials.
          </EmptyState>
        )}
      </section>

      <div className="grid items-start gap-8 xl:grid-cols-[1.2fr_1fr]">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Guided scenario</h2>
          <Card>
            <CardContent>
              <ol className="flex flex-col">
                {steps.map((step, index) => (
                  <ScenarioStep key={step.title} index={index} step={step} personas={personas} />
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        <div className="flex flex-col gap-8">

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">From the terminal</h2>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TerminalIcon className="text-primary size-4" /> Useful commands
                </CardTitle>
                <CardDescription>Run from the repository root.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {COMMANDS.map((item) => (
                  <div key={item.command} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <ArrowRightIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <code className="text-xs font-medium">{item.command}</code>
                      <div className="text-muted-foreground text-xs">{item.label}</div>
                    </div>
                    <CopyButton value={item.command} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
