import { cn } from "@/lib/utils";

/** SitePass mark: a shield with a check, on a rounded square. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M16 6.5l7.5 3.2v5.1c0 5-3.2 8.8-7.5 10.2-4.3-1.4-7.5-5.2-7.5-10.2V9.7L16 6.5z" fill="#fff" />
      <path
        d="M12.6 15.9l2.4 2.4 4.5-4.9"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="text-[#2d4fb0]" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight">SitePass</span>
        {subtitle && <span className="mt-1 text-[11px] font-medium opacity-60">Safety clearance registry</span>}
      </span>
    </span>
  );
}
