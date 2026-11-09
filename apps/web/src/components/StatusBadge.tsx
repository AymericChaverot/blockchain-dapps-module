import { Badge } from "@/components/ui/badge";
import { statusMeta } from "@/lib/credentials";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: number; className?: string }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={cn("gap-1", className)}>
      <Icon aria-hidden />
      {meta.label}
    </Badge>
  );
}

const BANNER_STYLES = {
  success: { box: "border-success/30 bg-success/[0.06]", icon: "bg-success text-white dark:text-background", text: "text-success" },
  danger: {
    box: "border-destructive/30 bg-destructive/[0.06]",
    icon: "bg-destructive text-white dark:text-background",
    text: "text-destructive",
  },
  warning: { box: "border-warning/35 bg-warning/[0.07]", icon: "bg-warning text-white dark:text-background", text: "text-warning" },
  suspended: {
    box: "border-suspended/35 bg-suspended/[0.07]",
    icon: "bg-suspended text-white dark:text-background",
    text: "text-suspended",
  },
  muted: { box: "border-border bg-muted/60", icon: "bg-muted-foreground/80 text-background", text: "text-muted-foreground" },
} as const;

/** Large, glanceable status block for the verifier at the site gate. */
export function StatusBanner({ status, children }: { status: number; children?: React.ReactNode }) {
  const meta = statusMeta(status);
  const style = BANNER_STYLES[meta.variant];
  const Icon = meta.icon;
  return (
    <div className={cn("flex items-center gap-4 rounded-xl border p-4 sm:p-5", style.box)}>
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full sm:size-14", style.icon)}>
        <Icon className="size-6 sm:size-7" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className={cn("text-xl font-semibold tracking-tight sm:text-2xl", style.text)}>{meta.label}</div>
        <div className="text-foreground/75 text-sm">{meta.description}</div>
        {children}
      </div>
    </div>
  );
}
