import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const KEY = "sitepass.theme";
const listeners = new Set<() => void>();
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let preference = read();

function apply() {
  const dark = preference === "dark" || (preference === "system" && darkQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function initTheme(): void {
  apply();
  darkQuery.addEventListener("change", apply);
}

export function setTheme(next: ThemePreference): void {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Not persisted: still applied for this session.
  }
  apply();
  for (const listener of listeners) listener();
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preference,
  );
}
