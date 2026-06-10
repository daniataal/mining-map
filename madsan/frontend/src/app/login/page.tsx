"use client";

import AppShell from "@/components/AppShell";
import LoginForm from "@/components/auth/LoginForm";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { AuthLoading } from "@/components/auth/AuthGate";

function LoginContent() {
  const { authed, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  useEffect(() => {
    if (!loading && authed) router.replace(next);
  }, [authed, loading, next, router]);

  if (loading) {
    return (
      <div className="auth-page-center">
        <AuthLoading />
      </div>
    );
  }

  if (authed) return null;

  return (
    <div className="auth-page-center">
      <LoginForm redirectTo={next} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <AppShell maxWidth="full">
      <Suspense fallback={<div className="auth-page-center"><AuthLoading /></div>}>
        <LoginContent />
      </Suspense>
    </AppShell>
  );
}
