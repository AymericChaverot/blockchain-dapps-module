import { Loader2Icon, LockKeyholeIcon, PresentationIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ConnectPrompt, WrongNetwork } from "@/components/Wallet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppMode } from "@/config/mode";
import { REQUIREMENT_LABEL } from "@/config/navigation";
import { type Requirement, useRoles } from "@/hooks/useRoles";

const PROMPTS: Record<Exclude<Requirement, "public">, { title: string; description: string; denied: string }> = {
  wallet: {
    title: "Connect your wallet",
    description: "Your credentials are bound to the wallet that received them.",
    denied: "",
  },
  issuer: {
    title: "Sign in as a trainer",
    description: "Connect your personal wallet: your organization added it as an issuing member.",
    denied:
      "This wallet is not an issuing member of any organization. Ask the admins of your organization to add it (a proposal in their multisig), then reconnect.",
  },
  affiliated: {
    title: "Sign in as a member of an organization",
    description: "Connect your personal wallet: admins and issuing members of an organization can open this page.",
    denied: "This wallet does not belong to any organization of the federation.",
  },
  orgAdmin: {
    title: "Sign in as an organization admin",
    description: "Connect the personal wallet of one of the admins of your organization.",
    denied: "Only the admins of an organization (its internal multisig) can do this.",
  },
};

/**
 * Role-based access to a page.
 *
 * Production: the page is replaced by a connect prompt or an "access
 * restricted" notice. Demo: the page stays open with a warning, so that the
 * contract's own rejection (e.g. `NotAuthorizedIssuer`) can be shown live.
 */
export function RequireRole({ requirement, children }: { requirement: Requirement; children: ReactNode }) {
  const roles = useRoles();
  const { isDemo } = useAppMode();

  if (requirement === "public") return <>{children}</>;
  const prompt = PROMPTS[requirement];
  if (!roles.isConnected) return <ConnectPrompt title={prompt.title} description={prompt.description} />;
  if (roles.wrongChain) return <WrongNetwork />;
  if (roles.isLoading) return <Loader2Icon className="text-muted-foreground mx-auto mt-10 size-6 animate-spin" />;
  if (roles.satisfies(requirement)) return <>{children}</>;

  if (isDemo) {
    return (
      <div className="flex flex-col gap-6">
        <Alert variant="warning">
          <PresentationIcon />
          <AlertTitle>Demo mode: this wallet is not a {REQUIREMENT_LABEL[requirement].toLowerCase()}</AlertTitle>
          <AlertDescription>
            In production this page is not reachable for this wallet. It stays open here so that you can show the
            smart contract rejecting the action on its own.
          </AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <span className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
          <LockKeyholeIcon className="size-5" />
        </span>
        <CardTitle>Access restricted</CardTitle>
        <CardDescription>
          This area requires the <b>{REQUIREMENT_LABEL[requirement]}</b> role. {prompt.denied}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/">Verify a credential</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/issuers">Accredited organizations</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
