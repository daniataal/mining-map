"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";
import type { MapSelection } from "./EntityDossierPanel";

export type SearchHit = {
  id: string;
  name: string;
  entity_type: string;
  country_code?: string;
  asset_type?: string;
  mmsi?: string;
  confidence_score?: number;
  latitude?: number;
  longitude?: number;
  subtitle?: string;
};

type Props = {
  open: boolean;
  vertical: "energy" | "metals";
  onClose: () => void;
  onSelect: (selection: MapSelection, focus?: { lat: number; lng: number }) => void;
};

export default function SearchPalette({ open, vertical, onClose, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(async (term: string) => {
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ q: term, vertical });
    const res = await fetch(`${API_BASE}/api/core/search?${params}`, authFetchOpts);
    setResults(res.ok ? await res.json() : []);
    setLoading(false);
  }, [vertical]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(q), 280);
    return () => clearTimeout(t);
  }, [q, open, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function pick(hit: SearchHit) {
    const selection: MapSelection = {
      id: hit.id,
      name: hit.name,
      mmsi: hit.mmsi,
      _entityType: hit.entity_type,
      asset_type: hit.asset_type,
      country_code: hit.country_code,
      confidence_score: hit.confidence_score,
    };
    const focus =
      hit.latitude != null && hit.longitude != null
        ? { lat: hit.latitude, lng: hit.longitude }
        : undefined;
    onSelect(selection, focus);
    onClose();
  }

  return (
    <div className="search-overlay" onClick={onClose} role="presentation">
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search companies, assets, vessels…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="search-hint">↵ select · esc close · ⌘K toggle</div>
        {loading && <div className="search-status">Searching…</div>}
        <ul className="search-results">
          {results.map((hit) => (
            <li key={`${hit.entity_type}-${hit.id}`}>
              <button type="button" className="search-hit" onClick={() => pick(hit)}>
                <span className="search-hit-name">{hit.name}</span>
                <span className="search-hit-meta">
                  {hit.entity_type}
                  {hit.subtitle ? ` · ${hit.subtitle}` : ""}
                  {hit.confidence_score != null ? ` · conf ${Math.round(hit.confidence_score)}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!loading && q.length >= 2 && results.length === 0 && (
            <li className="search-status">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
