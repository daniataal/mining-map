"use client";

import AuthGate from "@/components/auth/AuthGate";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  redirectTo?: string;
};

export default function RequireAuth({ children, redirectTo }: Props) {
  return <AuthGate redirectTo={redirectTo}>{children}</AuthGate>;
}
