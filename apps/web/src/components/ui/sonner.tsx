import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/lib/theme";

/** Toasts styled with the app tokens, following the light / dark / system preference. */
export function Toaster() {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      // Clear of the phone bottom bar.
      mobileOffset={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      closeButton
      icons={{
        success: <CircleCheckIcon className="text-success size-4" />,
        error: <OctagonXIcon className="text-destructive size-4" />,
        warning: <TriangleAlertIcon className="text-warning size-4" />,
        info: <InfoIcon className="text-primary size-4" />,
        loading: <Loader2Icon className="text-muted-foreground size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !shadow-lg !gap-2.5 !font-sans",
          title: "!font-semibold",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md",
          closeButton: "!bg-popover !text-muted-foreground !border-border hover:!text-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
    />
  );
}
