"use client";

import { useAuth } from "@/contexts/AuthContext";
import { loginHref } from "@/lib/authRedirect";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

type Props = {
  children?: ReactNode;
  /** Override return path (defaults to current pathname). */
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

/** Redirects unauthenticated users to /login?next=…; renders children when authed. */
export default function AuthGate({ children, redirectTo }: Props) {
  const { loading, authed } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const returnPath = redirectTo ?? pathname;

  useEffect(() => {
    if (!loading && !authed) {
      router.replace(loginHref(returnPath));
    }
  }, [loading, authed, returnPath, router]);

  if (loading) return <AuthLoading />;
  if (!authed) return <AuthLoading />;
  return children ? <>{children}</> : null;
}
