import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { shortHex } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label ?? "value"}`}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 rounded p-0.5 text-xs transition-colors",
        className,
      )}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          toast.error("Could not copy to the clipboard");
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon className="text-success size-3.5" /> : <CopyIcon className="size-3.5" />}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

/** Address / hash rendered short, with copy button and optional explorer link. */
export function HexValue({
  value,
  href,
  full = false,
  className,
}: {
  value: string;
  href?: string;
  full?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      <code className={cn("text-xs", full && "break-all")} title={value}>
        {full ? value : shortHex(value, 6)}
      </code>
      <CopyButton value={value} />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="Open in block explorer"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLinkIcon className="size-3.5" />
        </a>
      )}
    </span>
  );
}
