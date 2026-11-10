import {
  CircleCheckIcon,
  ClockIcon,
  HourglassIcon,
  PlayCircleIcon,
  ShieldOffIcon,
  TimerOffIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { type Address, isAddressEqual } from "viem";

import { AddressAvatar } from "@/components/Wallet";
import { HexValue } from "@/components/HexValue";
import { Badge } from "@/components/ui/badge";
import { explorerAddressUrl } from "@/config/network";
import { ORG_STATUS, ORG_STATUS_LABEL, type ProposalPhase } from "@/lib/governance";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Current unix time, refreshed every second (timelock countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function OrgStatusBadge({ status }: { status: number }) {
  switch (status) {
    case ORG_STATUS.ACTIVE:
      return (
        <Badge variant="success">
          <CircleCheckIcon /> Accredited
        </Badge>
      );
    case ORG_STATUS.SUSPENDED:
      return (
        <Badge variant="suspended">
          <ShieldOffIcon /> Suspended
        </Badge>
      );
    case ORG_STATUS.PENDING:
      return (
        <Badge variant="warning">
          <HourglassIcon /> Pending admission
        </Badge>
      );
    default:
      return <Badge variant="muted">{ORG_STATUS_LABEL[status] ?? "Unknown"}</Badge>;
  }
}

export function PhaseBadge({ phase, executableAt }: { phase: ProposalPhase; executableAt: bigint }) {
  switch (phase) {
    case "executed":
      return (
        <Badge variant="success">
          <CircleCheckIcon /> Executed
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="muted">
          <TimerOffIcon /> Expired
        </Badge>
      );
    case "collecting":
      return (
        <Badge variant="info">
          <UsersRoundIcon /> Collecting approvals
        </Badge>
      );
    case "timelocked":
      return (
        <Badge variant="warning" title="Delay between reaching the threshold and execution">
          <ClockIcon /> Timelock · executable {relativeTime(executableAt)}
        </Badge>
      );
    case "executable":
      return (
        <Badge variant="success">
          <PlayCircleIcon /> Ready to execute
        </Badge>
      );
  }
}

/** "2 / 3" with dots. */
export function ApprovalMeter({ approvals, required }: { approvals: number; required: number }) {
  const total = Math.max(required, approvals);
  return (
    <span className="inline-flex items-center gap-2" title={`${approvals} approval(s) of ${required} required`}>
      <span className="flex gap-1">
        {Array.from({ length: total }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: purely positional dots
            key={index}
            className={cn("size-2.5 rounded-full border", index < approvals ? "bg-success border-success" : "bg-muted")}
          />
        ))}
      </span>
      <span className="tabular text-sm font-medium">
        {approvals} / {required}
      </span>
    </span>
  );
}

/** A person (wallet) in an organization. */
export function PersonRow({ address, you, children }: { address: Address; you?: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <AddressAvatar address={address} />
      <HexValue value={address} href={explorerAddressUrl(address)} />
      {you && <Badge variant="info">You</Badge>}
      <span className="ml-auto">{children}</span>
    </li>
  );
}

export function isSame(a: Address | undefined, b: Address | undefined): boolean {
  return !!a && !!b && isAddressEqual(a, b);
}

/** Parses a list of addresses typed one per line or comma separated. */
export function parseAddressList(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0 && seconds >= 86_400) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60} min`;
  return `${seconds} s`;
}
