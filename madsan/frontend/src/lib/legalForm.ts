import type { CSSProperties } from "react";

export const LEGAL_CONTACT_EMAIL = "legal@madsan.dev";

export const fetchOpts: RequestInit = { credentials: "include" };

export const inputStyle: CSSProperties = {
  padding: 8,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export type LegalSubmitResult = {
  status?: string;
  queue_id?: string;
  error?: string;
  fallback?: boolean;
};

export function legalApiFallback(action: string): LegalSubmitResult {
  return {
    fallback: true,
    error: `Legal ${action} API is not deployed yet. Email ${LEGAL_CONTACT_EMAIL} with your reference details, or ask an operator to add a manual_review_queue row via Admin.`,
  };
}
