"use client";

import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/auth/UserMenu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Terminal" },
  { href: "/deals", label: "Deals" },
  { href: "/playground", label: "Playground" },
  { href: "/portal", label: "Portal" },
  { href: "/admin", label: "Admin" },
];

type Props = {
  children: ReactNode;
  maxWidth?: number | "full";
};

export default function AppShell({ children, maxWidth = 960 }: Props) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-brand">
          <Link href="/" className="app-shell-logo" title="MadSan Intelligence">
            <BrandMark size="header" />
          </Link>
          <span className="app-shell-tag">Intelligence</span>
        </div>
        <nav className="app-shell-nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)) ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="app-shell-actions">
          <ThemeToggle compact />
          <UserMenu />
        </div>
      </header>
      <main
        className="app-shell-main"
        style={maxWidth === "full" ? undefined : { maxWidth }}
      >
        {children}
      </main>
    </div>
  );
}
