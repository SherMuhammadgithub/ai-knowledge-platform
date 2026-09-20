"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme-script";

// Light, dark, or follow the operating system. The choice is kept in localStorage.
// The class on <html> is set before first paint by THEME_INIT_SCRIPT (src/lib/theme-script.ts, used in app/layout.tsx),
// and this provider keeps it in sync afterwards. No script is rendered from a client component.

export type Theme = "light" | "dark" | "system";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system"; // storage blocked (private mode, strict settings)
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // another tab changed the theme
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not saved, but the choice still applies for this visit.
  }
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  // The server always renders "system", the browser then reads the saved choice without a mismatch.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  return { theme, setTheme };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  // While the choice is "system", follow the operating system if it changes.
  useEffect(() => {
    if (theme !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  return children;
}
