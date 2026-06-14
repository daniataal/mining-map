export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "madsan-theme";

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    /* private browsing */
  }
  return "dark";
}

export function applyThemeClass(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
}

export function persistTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
