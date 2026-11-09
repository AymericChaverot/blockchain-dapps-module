import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  IdCardIcon,
  LogOutIcon,
  UserRoundCogIcon,
  WalletIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { type Address, isAddressEqual } from "viem";
import { type Connector, useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Persona, buildPersonas, useDemoSeed } from "@/config/demo";
import { useAppMode } from "@/config/mode";
import { chain, explorerAddressUrl, isConfigured, networkLabel } from "@/config/network";
import { useRoles } from "@/hooks/useRoles";
import { copyWithToast } from "@/lib/clipboard";
import { fetchRegistryOverview } from "@/lib/credentials";
import { DEMO_CONNECTOR_ID, switchDemoAccount } from "@/lib/demoWallet";
import { shortHex } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Deterministic two-tone avatar derived from an address. */
export function AddressAvatar({ address, className }: { address: string; className?: string }) {
  const hue = Number.parseInt(address.slice(2, 6), 16) % 360;
  const hue2 = (hue + 40 + (Number.parseInt(address.slice(6, 8), 16) % 80)) % 360;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-6 shrink-0 rounded-full", className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.13 ${hue}), oklch(0.45 0.12 ${hue2}))` }}
    />
  );
}

/** Wallet connectors available to the user, the demo wallet only in demo mode. */
function useWalletConnectors() {
  const { connectors } = useConnect();
  const { isDemo } = useAppMode();
  const real = connectors.filter((connector) => connector.id !== DEMO_CONNECTOR_ID);
  const discovered = real.filter((connector) => connector.id !== "injected");
  return {
    wallets: discovered.length > 0 ? discovered : real,
    demo: isDemo ? connectors.find((connector) => connector.id === DEMO_CONNECTOR_ID) : undefined,
  };
}

/** Personas of the demo, with the registry owner as admin. */
export function usePersonas(): Persona[] {
  const { isDemo } = useAppMode();
  const seed = useDemoSeed(isDemo);
  const registry = useQuery({ queryKey: ["registry"], queryFn: fetchRegistryOverview, enabled: isConfigured && isDemo });
  return isDemo ? buildPersonas(seed.data, registry.data?.owner) : [];
}

/** Connects the built-in demo wallet as `persona` (switching connector if needed). */
export function useActAs() {
  const { connector: active, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const demo = connectors.find((connector) => connector.id === DEMO_CONNECTOR_ID);

  return async (persona: Persona) => {
    if (!demo || !persona.builtIn) return;
    switchDemoAccount(persona.address);
    try {
      if (isConnected && active?.id === DEMO_CONNECTOR_ID) return;
      if (isConnected) await disconnectAsync();
      await connectAsync({ connector: demo });
    } catch (error) {
      toast.error("Could not switch persona", { description: (error as Error).message });
    }
  };
}

function connectorLabel(connector: Connector) {
  return connector.id === "injected" ? "Browser wallet" : connector.name;
}

/** Full list of ways to connect, used in access prompts. */
export function ConnectOptions() {
  const { wallets, demo } = useWalletConnectors();
  const { connect, isPending } = useConnect();
  const personas = usePersonas().filter((persona) => persona.builtIn);
  const actAs = useActAs();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {wallets.map((connector) => (
          <Button key={connector.uid} onClick={() => connect({ connector })} disabled={isPending}>
            {connector.icon ? <img src={connector.icon} alt="" className="size-4" /> : <WalletIcon />}
            Connect {connectorLabel(connector)}
          </Button>
        ))}
      </div>
      {demo && personas.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase">
            <UserRoundCogIcon className="size-3.5" /> Or act as a demo persona
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((persona) => (
              <button
                key={persona.id}
                type="button"
                onClick={() => actAs(persona)}
                className="hover:border-primary/40 hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-left transition-colors"
              >
                <AddressAvatar address={persona.address} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{persona.label}</span>
                  <span className="text-muted-foreground block text-xs">{persona.role}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Demo only: one-click persona switch in the top bar. */
export function PersonaSwitcher() {
  const personas = usePersonas().filter((persona) => persona.builtIn);
  const { address, connector } = useAccount();
  const actAs = useActAs();
  if (personas.length === 0) return null;

  const usingDemo = connector?.id === DEMO_CONNECTOR_ID;
  const current = usingDemo && address ? personas.find((persona) => isAddressEqual(persona.address, address)) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <UserRoundCogIcon />
          <span className="hidden sm:inline">{current ? current.label : "Act as…"}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Demo personas (built-in wallet, {networkLabel})</DropdownMenuLabel>
        {personas.map((persona) => (
          <DropdownMenuItem key={persona.id} onSelect={() => actAs(persona)} className="items-start">
            <AddressAvatar address={persona.address} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium">
                {persona.label}
                {current?.id === persona.id && <CheckIcon className="text-primary size-3.5" />}
              </span>
              <span className="text-muted-foreground block text-xs">
                {persona.role} · {shortHex(persona.address)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Top-bar account widget: connect button, or the connected account menu. */
export function AccountMenu() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { connect, isPending } = useConnect();
  const { wallets } = useWalletConnectors();
  const roles = useRoles();

  if (!isConnected || !address) {
    if (wallets.length <= 1) {
      const preferred = wallets[0];
      return (
        <Button size="sm" onClick={() => preferred && connect({ connector: preferred })} disabled={!preferred || isPending}>
          <WalletIcon /> Connect wallet
        </Button>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" disabled={isPending}>
            <WalletIcon /> Connect wallet <ChevronDownIcon className="opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {wallets.map((wallet) => (
            <DropdownMenuItem key={wallet.uid} onSelect={() => connect({ connector: wallet })}>
              {wallet.icon ? <img src={wallet.icon} alt="" className="size-4" /> : <WalletIcon />}
              {connectorLabel(wallet)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const explorer = explorerAddressUrl(address);
  return (
    <div className="flex items-center gap-2">
      {chainId !== chain.id && (
        <Button size="sm" variant="destructive" onClick={() => switchChain({ chainId: chain.id })} disabled={switching}>
          <AlertTriangleIcon /> <span className="hidden sm:inline">Switch to {networkLabel}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border bg-card py-1 pr-2 pl-1 text-left transition-colors"
          >
            <AddressAvatar address={address} />
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="font-mono text-xs font-medium">{shortHex(address)}</span>
              <span className="text-muted-foreground text-[11px]">{roles.issuerName ?? roles.primaryRole}</span>
            </span>
            <ChevronDownIcon className="text-muted-foreground size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center gap-3 px-2 py-2">
            <AddressAvatar address={address} className="size-8" />
            <div className="min-w-0">
              <div className="truncate font-mono text-xs">{shortHex(address, 6)}</div>
              <div className="text-muted-foreground text-xs">via {connector?.name ?? "wallet"}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            {roles.isAdmin && <Badge variant="info">Registry admin</Badge>}
            {roles.isIssuer && (
              <Badge variant={roles.isActiveIssuer ? "success" : "suspended"}>
                {roles.isActiveIssuer ? "Accredited issuer" : "Suspended issuer"}
              </Badge>
            )}
            <Badge variant="muted">Worker</Badge>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/wallet">
              <IdCardIcon /> My credentials
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => copyWithToast(address, "Address copied")}
          >
            <CopyIcon /> Copy address
          </DropdownMenuItem>
          {explorer && (
            <DropdownMenuItem asChild>
              <a href={explorer} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> View on explorer
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => disconnect()}>
            <LogOutIcon /> Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Prompt shown in place of a page that needs a wallet. */
export function ConnectPrompt({ title, description }: { title: string; description: string }) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <span className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
          <WalletIcon className="size-5" />
        </span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectOptions />
      </CardContent>
    </Card>
  );
}

export function WrongNetwork() {
  const { chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <Alert variant="warning" className="mx-auto max-w-xl">
      <AlertTriangleIcon />
      <AlertTitle>Wrong network</AlertTitle>
      <AlertDescription>
        <span>
          Your wallet is on chain {chainId}. SitePass is deployed on {networkLabel} (chain {chain.id}).
        </span>
        <Button size="sm" className="mt-2" onClick={() => switchChain({ chainId: chain.id })} disabled={isPending}>
          Switch to {networkLabel}
        </Button>
        {error && <span className="text-xs">{error.message}</span>}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Renders `children(address)` only once a wallet is connected on the right
 * chain. Never used by the verifier.
 */
export function WalletGate({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (address: Address) => ReactNode;
}) {
  const { address, isConnected, chainId } = useAccount();
  if (!isConnected || !address) return <ConnectPrompt title={title} description={description} />;
  if (chainId !== chain.id) return <WrongNetwork />;
  return <>{children(address)}</>;
}
