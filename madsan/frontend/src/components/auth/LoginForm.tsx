"use client";

import { isLocalDevApi } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

type Mode = "signin" | "register";

type Props = {
  title?: string;
  subtitle?: string;
  /** After successful auth, navigate here (e.g. /deals). */
  redirectTo?: string;
  onSuccess?: () => void;
  compact?: boolean;
  /** One-click dev accounts — only on /login, not on gated pages. */
  showDevShortcuts?: boolean;
};

const DEV_ACCOUNTS = [
  { label: "Analyst", email: "admin@madsan.dev", password: "devpass123" },
  { label: "Deals", email: "deals@madsan.dev", password: "devpass123" },
  { label: "Supplier", email: "supplier@madsan.dev", password: "devpass123" },
];

export default function LoginForm({
  title = "Sign in to MadSan",
  subtitle = "Cookie session — no tokens stored in the browser.",
  redirectTo,
  onSuccess,
  compact = false,
  showDevShortcuts = false,
}: Props) {
  const { login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const displayName = String(fd.get("display_name") ?? "").trim() || email.split("@")[0] || "User";

    const err =
      mode === "signin"
        ? await login(email, password)
        : await register({ email, password, displayName });

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onSuccess?.();
    if (redirectTo) router.replace(redirectTo);
  }

  function fillDevAccount(email: string, password: string) {
    const form = document.getElementById("madsan-auth-form") as HTMLFormElement | null;
    if (!form) return;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement | null;
    const passInput = form.elements.namedItem("password") as HTMLInputElement | null;
    if (emailInput) emailInput.value = email;
    if (passInput) passInput.value = password;
    setMode("signin");
    setError("");
  }

  return (
    <div className={`auth-card${compact ? " auth-card-compact" : ""}`}>
      <div className="auth-card-header">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
      </div>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={mode === "signin" ? "active" : ""}
          onClick={() => {
            setMode("signin");
            setError("");
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={mode === "register" ? "active" : ""}
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Create account
        </button>
      </div>

      <form id="madsan-auth-form" className="auth-form" onSubmit={handleSubmit}>
        {mode === "register" && (
          <label className="auth-field">
            <span>Display name</span>
            <input name="display_name" type="text" autoComplete="name" placeholder="Your name" />
          </label>
        )}
        <label className="auth-field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="••••••••" minLength={8} />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={16} className="auth-spinner" />
              {mode === "signin" ? "Signing in…" : "Creating account…"}
            </>
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
        </button>
      </form>

      {showDevShortcuts && isLocalDevApi() && (
        <div className="auth-dev-hint">
          <span className="auth-dev-label">Local dev accounts</span>
          <div className="auth-dev-buttons">
            {DEV_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" onClick={() => fillDevAccount(a.email, a.password)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
