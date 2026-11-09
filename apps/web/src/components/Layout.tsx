import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  EyeIcon,
  FileCode2Icon,
  IdCardIcon,
  LockKeyholeIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PresentationIcon,
  ScanLineIcon,
  ScanSearchIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from "react-router";

import { QrScannerDialog } from "@/components/QrScanner";
import { AccountMenu, PersonaSwitcher } from "@/components/Wallet";
import { Logo } from "@/components/layout/Logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppMode } from "@/config/mode";
import { NAV_SECTIONS, type NavItem, REQUIREMENT_LABEL } from "@/config/navigation";
import { chain, contracts, explorerAddressUrl, isConfigured, networkLabel, rpcUrl } from "@/config/network";
import { useRoles } from "@/hooks/useRoles";
import { shortHex } from "@/lib/format";
import { scannedCodePath } from "@/lib/scan";
import { type ThemePreference, setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Navigation filtered by role (production) or annotated with locks (demo). */
function useNavigation() {
  const roles = useRoles();
  const { isDemo } = useAppMode();
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => (item.demoOnly ? isDemo : true))
      .filter((item) => isDemo || roles.satisfies(item.requires))
      .map((item) => ({ ...item, locked: !roles.satisfies(item.requires) })),
  })).filter((section) => section.items.length > 0);
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const sections = useNavigation();
  return (
    <nav className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <div className="text-sidebar-muted px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
            {section.title}
          </div>
          {section.items.map((item: NavItem & { locked: boolean }) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              title={item.locked ? `Requires: ${REQUIREMENT_LABEL[item.requires]}` : undefined}
              className={({ isActive }) =>
                cn(
                  "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive && "bg-sidebar-accent text-sidebar-foreground font-medium shadow-[inset_2px_0_0_var(--sidebar-primary)]",
                )
              }
            >
              <item.icon className={cn("size-4 shrink-0", item.locked && "opacity-60")} />
              <span className={cn("flex-1 truncate", item.locked && "opacity-70")}>{item.label}</span>
              {item.locked && <LockKeyholeIcon className="text-sidebar-muted size-3.5" />}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { isDemo, isPreview } = useAppMode();
  return (
    <div className="border-sidebar-border text-sidebar-muted flex flex-col gap-2 border-t px-5 py-4 text-xs">
      <div className="flex items-center gap-2" title={rpcUrl}>
        <span className="relative flex size-2">
          <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-50" />
          <span className="bg-success relative inline-flex size-2 rounded-full" />
        </span>
        <span className="text-sidebar-foreground/90 font-medium">{networkLabel}</span>
        <span>· chain {chain.id}</span>
      </div>
      {contracts.siteCredentialManager && (
        <a
          className="hover:text-sidebar-foreground flex items-center gap-2 font-mono"
          href={explorerAddressUrl(contracts.siteCredentialManager)}
          target="_blank"
          rel="noreferrer"
        >
          <FileCode2Icon className="size-3.5" /> {shortHex(contracts.siteCredentialManager, 5)}
        </a>
      )}
      <div className="flex items-center gap-2">
        {isDemo ? <PresentationIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        {isDemo ? "Demo mode" : isPreview ? "Production preview" : "Production"}
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="text-sidebar-foreground flex h-16 shrink-0 items-center px-5">
        <Logo />
      </Link>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <SidebarNav onNavigate={onNavigate} />
      </div>
      <SidebarFooter />
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <MenuIcon />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="bg-sidebar data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left fixed inset-y-0 left-0 z-50 w-72 shadow-xl duration-200">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">SitePass sections</DialogPrimitive.Description>
          <DialogPrimitive.Close className="text-sidebar-muted hover:text-sidebar-foreground absolute top-5 right-4 cursor-pointer">
            <XIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

function ThemeMenu() {
  const theme = useTheme();
  const Current = THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? MonitorIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Current />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon /> {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function usePageTitle(): string {
  const { pathname } = useLocation();
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (matchPath({ path: item.to, end: item.end ?? true }, pathname)) return item.label;
    }
  }
  if (pathname.startsWith("/holder")) return "Worker credentials";
  if (pathname.startsWith("/prove")) return "Proof of control";
  return "SitePass";
}

function ModeStrip() {
  const { isDemo, isPreview, setPreviewProduction } = useAppMode();
  if (isDemo) {
    return (
      <div className="bg-primary text-primary-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <PresentationIcon className="size-3.5" /> Demo mode
        </span>
        <span className="hidden opacity-80 sm:inline">Every page is open, seeded data and personas are available.</span>
        <Link to="/demo" className="font-medium underline underline-offset-2">
          Demo console
        </Link>
        <button
          type="button"
          className="cursor-pointer font-medium underline underline-offset-2"
          onClick={() => setPreviewProduction(true)}
        >
          Preview production
        </button>
      </div>
    );
  }
  if (isPreview) {
    return (
      <div className="bg-foreground text-background flex flex-wrap items-center justify-center gap-x-3 px-4 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <EyeIcon className="size-3.5" /> Production preview: navigation and access follow the connected wallet's role.
        </span>
        <button
          type="button"
          className="cursor-pointer font-medium underline underline-offset-2"
          onClick={() => setPreviewProduction(false)}
        >
          Back to demo mode
        </button>
      </div>
    );
  }
  return null;
}

/** Phone-first bottom bar: the two everyday actions and a central scan button. */
function MobileTabBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
      isActive ? "text-primary" : "text-muted-foreground",
    );
  return (
    <>
      <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <NavLink to="/" end className={tab}>
          <ScanSearchIcon className="size-5" /> Verify
        </NavLink>
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-primary text-primary-foreground -mt-5 flex size-16 cursor-pointer flex-col items-center justify-center rounded-full border-4 border-background shadow-lg"
            aria-label="Scan a QR code"
          >
            <ScanLineIcon className="size-6" />
            <span className="text-[10px] font-semibold">Scan</span>
          </button>
        </div>
        <NavLink to="/wallet" className={tab}>
          <IdCardIcon className="size-5" /> My credentials
        </NavLink>
      </nav>
      <QrScannerDialog
        open={open}
        onOpenChange={setOpen}
        title="Scan a SitePass code"
        hint="A worker's credential, or the code shown by a verifier at the gate."
        manualPlaceholder="Credential ID, wallet address or link"
        onScan={(code) => {
          const path = scannedCodePath(code);
          if (!path) {
            return code.kind === "signature"
              ? "This is a signature: scan it from the verification screen."
              : "Not a SitePass code.";
          }
          navigate(path);
          return true;
        }}
      />
    </>
  );
}

export function Layout() {
  const title = usePageTitle();
  const { isDemo } = useAppMode();

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ModeStrip />
        <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <MobileNav />
            <Link to="/" className="lg:hidden">
              <Logo subtitle={false} />
            </Link>
            <div className="text-muted-foreground hidden items-center gap-2 text-sm lg:flex">
              <span>SitePass</span>
              <span className="opacity-50">/</span>
              <span className="text-foreground font-medium">{title}</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {isDemo && <PersonaSwitcher />}
              <ThemeMenu />
              <AccountMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-28 lg:pb-8">
          {!isConfigured && (
            <Alert variant="warning">
              <AlertTitle>SitePass is not deployed on {networkLabel} (chain {chain.id})</AlertTitle>
              <AlertDescription>
                Run <code>pnpm deploy:local</code> (with <code>pnpm chain</code> running) or{" "}
                <code>pnpm deploy:base-sepolia</code>, or set the contract addresses in the root <code>.env</code>.
              </AlertDescription>
            </Alert>
          )}
          <Outlet />
        </main>

        <footer className="text-muted-foreground hidden border-t px-4 py-4 text-xs sm:px-6 lg:block">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>SitePass · No personal data on-chain: only SHA-256 fingerprints of the certificates.</span>
            <span>
              {networkLabel} · chain {chain.id}
            </span>
          </div>
        </footer>
      </div>
      <MobileTabBar />
    </div>
  );
}
