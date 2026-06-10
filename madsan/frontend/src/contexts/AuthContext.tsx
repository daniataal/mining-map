"use client";

import {
  clearLegacyAuthTokens,
  fetchSession,
  loginWithPassword,
  logoutSession,
  registerAccount,
} from "@/lib/auth";
import type { MeResponse } from "@/lib/entitlements";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type AuthContextValue = {
  me: MeResponse | null;
  loading: boolean;
  authed: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<string | null>;
  register: (opts: {
    email: string;
    password: string;
    displayName: string;
    tenantSlug?: string;
  }) => Promise<string | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const profile = await fetchSession();
    setMe(profile);
    setLoading(false);
  }, []);

  useEffect(() => {
    clearLegacyAuthTokens();
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const err = await loginWithPassword(email, password);
      if (err) return err;
      await refresh();
      return null;
    },
    [refresh],
  );

  const register = useCallback(
    async (opts: { email: string; password: string; displayName: string; tenantSlug?: string }) => {
      const regErr = await registerAccount(opts);
      if (regErr) return regErr;
      const loginErr = await loginWithPassword(opts.email, opts.password);
      if (loginErr) return loginErr;
      await refresh();
      return null;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await logoutSession();
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({
      me,
      loading,
      authed: !!me?.uid,
      refresh,
      login,
      register,
      logout,
    }),
    [me, loading, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
