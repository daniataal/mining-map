"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  onValueChange: (v: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within Tabs");
  return ctx;
}

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("tabs-root", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("tabs-list", className)} role="tablist">{children}</div>;
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active, onValueChange } = useTabs();
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn("tabs-trigger", selected && "active", className)}
      onClick={() => onValueChange(value)}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active } = useTabs();
  if (active !== value) return null;
  return (
    <div className={cn("tabs-content", className)} role="tabpanel">
      {children}
    </div>
  );
}
