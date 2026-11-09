import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { WagmiProvider } from "wagmi";

import { App } from "@/App";
import { wagmiConfig } from "@/config/wagmi";
import "@/index.css";
import { initTheme } from "@/lib/theme";

// Light / dark / system preference, persisted per browser.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Always show fresh on-chain state (e.g. right after a revocation).
      staleTime: 0,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
