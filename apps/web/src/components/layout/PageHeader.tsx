import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && (
          <div className="text-primary flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
        {description && <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Compact KPI tile. */
export function StatTile({
  label,
  value,
  icon,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "danger" | "warning" | "suspended";
  hint?: ReactNode;
}) {
  const tones = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-warning/12 text-warning",
    suspended: "bg-suspended/10 text-suspended",
  } as const;
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-4">
      {icon && (
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5", tones[tone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      </div>
    </div>
  );
}

/** Empty state block with an icon. */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full [&>svg]:size-5">
        {icon}
      </span>
      <div className="font-medium">{title}</div>
      {children && <div className="text-muted-foreground max-w-md text-sm">{children}</div>}
    </div>
  );
}
