/** First attributable URL on a cargo or trade row for "Verify at source". */

export function firstVerifyUrl(record: {
  sources?: Array<{ name?: string; url?: string }>;
  evidence_chain?: string[];
}): string | null {
  for (const s of record.sources ?? []) {
    const url = s.url?.trim();
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  for (const ev of record.evidence_chain ?? []) {
    const m = String(ev).match(/https?:\/\/[^\s)\]"']+/i);
    if (m?.[0]) return m[0];
  }
  return null;
}
