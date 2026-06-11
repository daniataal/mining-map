"use client";

import AppShell from "@/components/AppShell";
import AuthGate from "@/components/auth/AuthGate";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { FEATURE, type FeatureKey } from "@/lib/entitlements";
import Link from "next/link";

const FEATURE_LABELS: Record<FeatureKey, string> = {
  [FEATURE.dealVerification]: "Deal verification",
  [FEATURE.dealPackExport]: "Deal pack export",
  [FEATURE.dealWatch]: "Deal watchlists",
  [FEATURE.mapPremiumLayers]: "Premium map layers",
  [FEATURE.supplierDiscovery]: "Supplier discovery",
  [FEATURE.supplierPortal]: "Supplier portal",
  [FEATURE.apiAccess]: "Admin API access",
};

function AccountBody() {
  const { me, logout } = useAuth();
  const ents = me?.entitlements ?? {};

  return (
    <div className="account-page">
      <div className="account-header">
        <div>
          <h1>Account</h1>
          <p className="account-subtitle">Session, tenant membership, and plan entitlements.</p>
        </div>
        <button type="button" className="account-signout" onClick={() => logout()}>
          Sign out
        </button>
      </div>

      <section className="account-card">
        <h2>Profile</h2>
        <dl className="account-dl">
          <div>
            <dt>Name</dt>
            <dd>{me?.display_name || "—"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{me?.email || "—"}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{me?.role || "viewer"}</dd>
          </div>
          <div>
            <dt>Tenant</dt>
            <dd>{me?.tenant_slug || me?.tid || "—"}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              <Badge variant="outline">{me?.plan || "unknown"}</Badge>
            </dd>
          </div>
        </dl>
      </section>

      <section className="account-card">
        <h2>Entitlements</h2>
        <p className="account-hint">Features unlocked for your tenant plan. Contact admin to upgrade.</p>
        <ul className="account-entitlements">
          {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((key) => {
            const on = !!ents[key];
            return (
              <li key={key} className={on ? "on" : "off"}>
                <span>{FEATURE_LABELS[key]}</span>
                <Badge variant={on ? "verified" : "muted"}>{on ? "Included" : "Not included"}</Badge>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="account-card">
        <h2>Quick links</h2>
        <div className="account-links">
          <Link href="/deals">Deal verification</Link>
          <Link href="/portal">Supplier portal</Link>
          <Link href="/admin">Admin console</Link>
          <Link href="/">Intelligence terminal</Link>
        </div>
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell>
      <AuthGate>
        <AccountBody />
      </AuthGate>
    </AppShell>
  );
}
