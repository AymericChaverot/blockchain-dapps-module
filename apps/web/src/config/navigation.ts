import {
  BuildingIcon,
  FilePlus2Icon,
  IdCardIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PresentationIcon,
  ScanSearchIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { Requirement } from "@/hooks/useRoles";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  requires: Requirement;
  end?: boolean;
  /** Only listed in demo mode. */
  demoOnly?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Verification",
    items: [
      { to: "/", label: "Verify a credential", icon: ScanSearchIcon, requires: "public", end: true },
      { to: "/issuers", label: "Accredited organizations", icon: BuildingIcon, requires: "public" },
    ],
  },
  {
    title: "Worker",
    items: [{ to: "/wallet", label: "My credentials", icon: IdCardIcon, requires: "wallet" }],
  },
  {
    title: "Training organization",
    items: [
      { to: "/issuer", label: "Overview", icon: LayoutDashboardIcon, requires: "issuer", end: true },
      { to: "/issuer/new", label: "Issue a credential", icon: FilePlus2Icon, requires: "issuer" },
      { to: "/organization", label: "My organization", icon: UsersRoundIcon, requires: "affiliated" },
    ],
  },
  {
    title: "Governance",
    items: [{ to: "/governance", label: "Federation governance", icon: LandmarkIcon, requires: "public" }],
  },
  {
    title: "Demo",
    items: [{ to: "/demo", label: "Demo console", icon: PresentationIcon, requires: "public", demoOnly: true }],
  },
];

export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  public: "Everyone",
  wallet: "Connected wallet",
  issuer: "Issuing member",
  affiliated: "Organization member",
  orgAdmin: "Organization admin",
};
