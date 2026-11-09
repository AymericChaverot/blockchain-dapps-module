/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: "localhost" | "baseSepolia";
  readonly VITE_APP_MODE?: "demo" | "production";
  readonly VITE_LOCAL_RPC_URL?: string;
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string;
  readonly VITE_ISSUER_REGISTRY_ADDRESS?: string;
  readonly VITE_SITE_CREDENTIAL_MANAGER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
