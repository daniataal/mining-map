/** S18 confidence tier colors: high / mid / low / none */
export function confidenceTierClass(score?: number | string, status?: string): string {
  const n = score != null && score !== "" ? Number(score) : NaN;
  if (!Number.isFinite(n) && !status) return "tier-none";
  if (status === "verified" || (Number.isFinite(n) && n >= 80)) return "tier-high";
  if (status === "partial" || (Number.isFinite(n) && n >= 50)) return "tier-mid";
  return "tier-low";
}

export function confidenceTierLabel(score?: number | string, status?: string): string {
  const cls = confidenceTierClass(score, status);
  if (cls === "tier-high") return "High";
  if (cls === "tier-mid") return "Review";
  if (cls === "tier-low") return "Low";
  return "Unknown";
}
