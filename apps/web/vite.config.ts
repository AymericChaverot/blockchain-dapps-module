import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const SUPPORTED_NETWORKS = ["localhost", "baseSepolia"] as const;
// Single `.env` for the whole monorepo, at the repository root.
const envDir = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "VITE_");
  // `vite --mode localhost` / `--mode baseSepolia` override VITE_NETWORK.
  const network = (SUPPORTED_NETWORKS as readonly string[]).includes(mode)
    ? mode
    : env.VITE_NETWORK || "localhost";

  // `--host` (pnpm web:mobile) exposes the dev server on the LAN for phones. The camera needs
  // a secure context, so HTTPS with a self-signed certificate is enabled in that case.
  const lan = process.argv.includes("--host");
  const localRpc = env.VITE_LOCAL_RPC_URL || "http://127.0.0.1:8545";

  return {
    envDir,
    plugins: [react(), tailwindcss(), ...(lan ? [basicSsl()] : [])],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    define: {
      "import.meta.env.VITE_NETWORK": JSON.stringify(network),
    },
    server: {
      port: Number(env.VITE_PORT || 5173),
      // Phones reach the local chain through the dev server (see config/network.ts).
      proxy: { "/rpc": { target: localRpc, changeOrigin: true, rewrite: () => "/" } },
    },
    preview: { port: Number(env.VITE_PORT || 5173) },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        // viem/ox ship /*#__PURE__*/ annotations Rollup cannot place; harmless.
        onwarn(warning, warn) {
          if (warning.code === "INVALID_ANNOTATION") return;
          warn(warning);
        },
      },
    },
  };
});
