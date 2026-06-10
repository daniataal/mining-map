"use client";

import LoginForm from "@/components/auth/LoginForm";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  /** Show inline login form instead of redirecting to /login */
  inline?: boolean;
  redirectTo?: string;
};

export function AuthLoading() {
  return (
    <div className="auth-loading">
      <Loader2 size={20} className="auth-spinner" />
      <span>Checking session…</span>
    </div>
  );
}

export default function AuthGate({ children, title, subtitle, inline = true, redirectTo }: Props) {
  const { loading, authed } = useAuth();

  if (loading) return <AuthLoading />;

  if (!authed) {
    if (!inline) return null;
    return (
      <LoginForm
        title={title}
        subtitle={subtitle}
        redirectTo={redirectTo}
      />
    );
  }

  return children ? <>{children}</> : null;
}
