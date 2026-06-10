"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

export type HistoricPreset = "7d" | "30d" | "90d" | "1y" | "custom";

export type HistoricRange = {
  preset: HistoricPreset;
  from: string;
  to: string;
};

export type AggregateBucket = {
  bucket_start: string;
  bucket_end: string;
  count: number;
  value?: number;
  label?: string;
};

export type HistoricAggregateResponse = {
  entity_type: string;
  entity_id: string;
  metric: string;
  bucket: string;
  from: string;
  to: string;
  buckets: AggregateBucket[];
  tier: string;
  disclaimer?: string;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function rangeFromPreset(preset: HistoricPreset, custom?: Partial<HistoricRange>): HistoricRange {
  const to = custom?.to ?? new Date().toISOString();
  if (preset === "custom" && custom?.from) {
    return { preset, from: custom.from, to };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
  return { preset, from: isoDaysAgo(days), to };
}

export function useHistoricRange(initial: HistoricPreset = "30d") {
  const [range, setRange] = useState<HistoricRange>(() => rangeFromPreset(initial));
  const setPreset = useCallback((preset: HistoricPreset) => {
    setRange(rangeFromPreset(preset));
  }, []);
  const setCustomRange = useCallback((from: string, to: string) => {
    setRange({ preset: "custom", from, to });
  }, []);
  return { range, setPreset, setCustomRange };
}

type FetchOpts = {
  entityType: string;
  entityId: string;
  metric?: string;
  bucket?: string;
  range: HistoricRange;
  enabled?: boolean;
};

/** Server-side aggregates only — never loads raw history rows into the browser. */
export function useHistoricAggregates({
  entityType,
  entityId,
  metric = "signals",
  bucket = "day",
  range,
  enabled = true,
}: FetchOpts) {
  const [data, setData] = useState<HistoricAggregateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const url = useMemo(() => {
    if (!entityId) return "";
    const q = new URLSearchParams({
      from: range.from,
      to: range.to,
      metric,
      bucket,
    });
    return `${API_BASE}/api/core/aggregates/${entityType}/${encodeURIComponent(entityId)}?${q}`;
  }, [entityType, entityId, range.from, range.to, metric, bucket]);

  useEffect(() => {
    if (!enabled || !url) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(url, authFetchOpts)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<HistoricAggregateResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Failed to load aggregates");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return { data, loading, error };
}
