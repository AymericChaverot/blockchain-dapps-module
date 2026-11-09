import { useSyncExternalStore } from "react";

/**
 * Application mode, chosen at build time with VITE_APP_MODE:
 *
 * - `demo`: everything is reachable from the navigation whatever the
 *   connected wallet, the role guards only warn (so that the contract's
 *   rejections can be shown live), a demo console lists personas, seeded
 *   credentials and sample certificates, and on the local chain a built-in
 *   wallet lets you switch persona in one click.
 * - `production`: pages are only listed and reachable for the roles that can
 *   use them (visitor, worker, issuer, registry admin); no demo affordance.
 *
 * A demo build can preview the production experience at runtime (persisted
 * per browser); a production build can never switch to demo.
 */
export type AppMode = "demo" | "production";

export const BUILD_MODE: AppMode = import.meta.env.VITE_APP_MODE === "production" ? "production" : "demo";

const PREVIEW_KEY = "sitepass.preview-production";
const listeners = new Set<() => void>();

function readPreview(): boolean {
  if (BUILD_MODE !== "demo") return false;
  try {
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

let previewProduction = readPreview();

export function setPreviewProduction(value: boolean): void {
  if (BUILD_MODE !== "demo") return;
  previewProduction = value;
  try {
    if (value) localStorage.setItem(PREVIEW_KEY, "1");
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Storage unavailable: the preview only lasts for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentMode(): AppMode {
  return BUILD_MODE === "demo" && !previewProduction ? "demo" : "production";
}

export function useAppMode() {
  const preview = useSyncExternalStore(subscribe, () => previewProduction);
  const mode: AppMode = BUILD_MODE === "demo" && !preview ? "demo" : "production";
  return {
    mode,
    isDemo: mode === "demo",
    /** True when a demo build is previewing the production experience. */
    isPreview: BUILD_MODE === "demo" && preview,
    canSwitch: BUILD_MODE === "demo",
    setPreviewProduction,
  };
}
