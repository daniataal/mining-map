"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { canUse, FEATURE } from "@/lib/entitlements";
import type { MapSelection } from "./EntityDossierPanel";

const STORAGE_KEY = "madsan_map_watchlist_v1";

export type WatchItem = {
  id: string;
  entityType: string;
  name: string;
  mmsi?: string;
  addedAt: string;
  alertTypes: string[];
};

function readWatchlist(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWatchlist(items: WatchItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function watchKey(entityType: string, id: string) {
  return `${entityType}:${id}`;
}

export function isWatched(items: WatchItem[], entityType: string, id: string) {
  const key = watchKey(entityType, id);
  return items.some((w) => watchKey(w.entityType, w.id) === key);
}

type Props = {
  selection: MapSelection | null;
  authed: boolean;
  canDealWatch: boolean;
  onSelect?: (sel: MapSelection) => void;
};

const ALERT_CATALOG = [
  { id: "stale_ais", label: "Stale AIS (>72h)", description: "Vessel not seen on open AIS feed" },
  { id: "gulf_gap", label: "Gulf coverage gap", description: "Position in sparse AIS provider region" },
  { id: "sanctions", label: "Sanctions rescreen", description: "Requires deal verification with OpenSanctions key" },
  { id: "price_delta", label: "Benchmark move", description: "Deal watch worker — price context change" },
];

export default function WatchlistsPanel({ selection, authed, canDealWatch, onSelect }: Props) {
  const [items, setItems] = useState<WatchItem[]>([]);

  useEffect(() => {
    setItems(readWatchlist());
  }, []);

  const persist = useCallback((next: WatchItem[]) => {
    setItems(next);
    writeWatchlist(next);
  }, []);

  const addCurrent = useCallback(() => {
    if (!selection) return;
    const id = selection.id ?? selection.mmsi;
    if (!id) return;
    const entityType = selection._entityType ?? "asset";
    if (isWatched(items, entityType, id)) return;
    const next: WatchItem = {
      id,
      entityType,
      name: String(selection.name ?? id),
      mmsi: selection.mmsi,
      addedAt: new Date().toISOString(),
      alertTypes: ["stale_ais", "gulf_gap"],
    };
    persist([next, ...items]);
  }, [items, persist, selection]);

  const remove = useCallback(
    (entityType: string, id: string) => {
      const key = watchKey(entityType, id);
      persist(items.filter((w) => watchKey(w.entityType, w.id) !== key));
    },
    [items, persist],
  );

  const selectionId = selection?.id ?? selection?.mmsi;
  const selectionType = selection?._entityType ?? "asset";
  const onWatchlist = selectionId ? isWatched(items, selectionType, selectionId) : false;

  return (
    <div className="watchlists-panel">
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        Local map watchlist (browser storage). Deal-level monitoring uses authenticated deal watch on the Deals page.
      </p>

      {selection && (
        <div className="intel-card" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 12 }}>{selection.name ?? selectionId}</strong>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="panel-btn" onClick={addCurrent} disabled={onWatchlist || !selectionId}>
              {onWatchlist ? "On watchlist" : "Add to watchlist"}
            </button>
            {onWatchlist && selectionId && (
              <button type="button" className="panel-btn muted" onClick={() => remove(selectionType, selectionId)}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 12 }}>Alert types</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11, color: "var(--muted)" }}>
          {ALERT_CATALOG.map((a) => (
            <li key={a.id} style={{ marginBottom: 4 }}>
              <span style={{ color: "var(--text)" }}>{a.label}</span> — {a.description}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong style={{ fontSize: 12 }}>Watchlist ({items.length})</strong>
        {items.length === 0 ? (
          <p className="disclaimer" style={{ marginTop: 8, paddingTop: 0, borderTop: 0 }}>
            No watched entities. Select a vessel or asset on the map and add it here.
          </p>
        ) : (
          <ul className="rel-list">
            {items.map((w) => (
              <li key={watchKey(w.entityType, w.id)}>
                <button
                  type="button"
                  className="rel-link"
                  onClick={() =>
                    onSelect?.({
                      id: w.id,
                      mmsi: w.mmsi,
                      name: w.name,
                      _entityType: w.entityType,
                    })
                  }
                >
                  <span className="rel-type">{w.entityType}</span>
                  <span className="rel-name">{w.name}</span>
                  <span className="rel-meta">added {new Date(w.addedAt).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  className="panel-btn muted"
                  style={{ marginTop: 4, width: "100%" }}
                  onClick={() => remove(w.entityType, w.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {authed && canDealWatch && (
        <div style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 12 }}>Deal watch</strong>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0" }}>
            Subscribe to price, vessel, and sanctions diffs on verified deal packs.
          </p>
          <Link href="/deals" className="panel-btn" style={{ display: "inline-block", textDecoration: "none" }}>
            Open deals →
          </Link>
        </div>
      )}

      {!canDealWatch && authed && (
        <p className="disclaimer" style={{ marginTop: 12 }}>
          Deal watch requires plan entitlement ({FEATURE.dealWatch}).
        </p>
      )}
    </div>
  );
}

/** Hook for other panels — check deal watch entitlement */
export function useDealWatchAvailable(me: { entitlements?: Record<string, boolean> } | null) {
  return canUse(me, FEATURE.dealWatch);
}
