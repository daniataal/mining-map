"use client";

import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, LogOut, User } from "lucide-react";
import { loginHref } from "@/lib/authRedirect";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  /** compact = icon-only trigger for the terminal ticker */
  compact?: boolean;
};

function displayLabel(email?: string, displayName?: string): string {
  if (displayName) return displayName;
  if (email) return email.split("@")[0] ?? email;
  return "Account";
}

export default function UserMenu({ compact = false }: Props) {
  const { me, authed, loading, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (loading) {
    return <span className="user-menu-loading">…</span>;
  }

  if (!authed) {
    return (
      <Link href={loginHref(pathname)} className={`user-menu-signin${compact ? " compact" : ""}`}>
        Sign in
      </Link>
    );
  }

  const label = displayLabel(me?.email, me?.display_name);

  return (
    <div className={`user-menu${compact ? " compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="user-menu-avatar">
          <User size={compact ? 12 : 14} />
        </span>
        {!compact && <span className="user-menu-label">{label}</span>}
        {me?.plan && <span className="user-menu-plan">{me.plan}</span>}
        <ChevronDown size={12} className={`user-menu-chevron${open ? " open" : ""}`} />
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-meta">
            <strong>{me?.display_name || label}</strong>
            {me?.email && <span>{me.email}</span>}
            <span className="user-menu-role">
              {me?.role ?? "viewer"}
              {me?.tenant_slug ? ` · ${me.tenant_slug}` : ""}
              {me?.plan ? ` · ${me.plan}` : ""}
            </span>
          </div>
          <Link href="/account" className="user-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Account &amp; plan
          </Link>
          <button
            type="button"
            className="user-menu-item danger"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
