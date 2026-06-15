"use client";

import AppShell from "@/components/AppShell";
import BrandMark from "@/components/BrandMark";
import LoginForm from "@/components/auth/LoginForm";
import { AuthLoading } from "@/components/auth/AuthGate";
import { useAuth } from "@/contexts/AuthContext";
import { nextPathLabel, sanitizeNextPath } from "@/lib/authRedirect";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function LoginContent() {
  const { authed, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = sanitizeNextPath(params.get("next"));
  const returnLabel = nextPathLabel(next);

  useEffect(() => {
    if (!loading && authed) router.replace(next);
  }, [authed, loading, next, router]);

  if (loading) {
    return (
      <div className="auth-page-full">
        <AuthLoading />
      </div>
    );
  }

  if (authed) return null;

  return (
    <div className="auth-page-full">
      <div className="auth-page-brand">
        <BrandMark size="lg" />
        <span className="auth-page-tag">Intelligence</span>
      </div>
      {next !== "/" && (
        <p className="auth-return-hint">
          After sign in you&apos;ll return to <strong>{returnLabel}</strong>.
        </p>
      )}
      <LoginForm redirectTo={next} showDevShortcuts />
    </div>
  );
}

export default function LoginPage() {
  return (
    <AppShell maxWidth="full">
      <Suspense
        fallback={
          <div className="auth-page-full">
            <AuthLoading />
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </AppShell>
  );
}
