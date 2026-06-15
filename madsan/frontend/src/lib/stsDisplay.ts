import type { MapSelection } from "@/components/EntityDossierPanel";

export function stsEventKindLabel(kind?: string): string {
  switch (kind) {
    case "prediction":
      return "STS prediction";
    case "historic":
      return "Historic STS";
    case "verified":
      return "Verified STS";
    case "inferred":
    default:
      return "Inferred STS (AIS proximity)";
  }
}

export function stsHoverLabel(props: Record<string, unknown>): string | null {
  if (!props.mmsi_a && !props.mmsi_b && !props.event_kind && !props.future_pair_probability) return null;
  const title =
    (props.name as string) ||
    (props.event_title as string) ||
    [props.vessel_a_name, props.vessel_b_name].filter(Boolean).join(" ↔ ") ||
    "STS event";
  const kind = stsEventKindLabel(props.event_kind as string | undefined);
  const parts = [kind, title];
  if (props.future_pair_probability) parts.push(`prob ${Math.round(Number(props.future_pair_probability))}`);
  if (props.horizon_hours) parts.push(`${props.horizon_hours}h`);
  if (props.product_hint) parts.push(String(props.product_hint));
  return parts.join(" · ");
}

export function isStsSelection(selection: MapSelection | null | undefined): boolean {
  return selection?._entityType === "sts" || selection?._layer === "sts-events" || selection?._layer === "sts-predictions";
}

export function formatStsWhen(start?: string, end?: string, observed?: string): string {
  const fmt = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a} → ${b}`;
  return a || fmt(observed) || "—";
}
