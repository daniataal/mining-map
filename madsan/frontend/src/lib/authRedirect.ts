/** Safe internal return path for post-login redirect (?next=). */

const DEFAULT_NEXT = "/";

/** Human label for common MadSan routes (login page hint). */
const ROUTE_LABELS: Record<string, string> = {
  "/": "Terminal",
  "/deals": "Deals",
  "/portal": "Portal",
  "/admin": "Admin",
  "/account": "Account",
  "/admin/data-quality": "Data quality",
};

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_NEXT;
  const path = raw.trim();
  // Reject protocol-relative and absolute URLs (open redirect).
  if (!path.startsWith("/") || path.startsWith("//")) return DEFAULT_NEXT;
  if (path.startsWith("/login")) return DEFAULT_NEXT;
  return path;
}

export function loginHref(nextPath: string): string {
  const next = sanitizeNextPath(nextPath);
  if (next === DEFAULT_NEXT) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

export function nextPathLabel(nextPath: string): string {
  const path = sanitizeNextPath(nextPath);
  if (ROUTE_LABELS[path]) return ROUTE_LABELS[path];
  if (path.startsWith("/admin")) return "Admin";
  return "the page you requested";
}
