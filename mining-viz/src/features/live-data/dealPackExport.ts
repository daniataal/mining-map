import type { DealExecutionPack } from '../../api/oilLiveApi';

export function dealPackToMarkdown(pack: DealExecutionPack, opportunityId: string): string {
  const lines: string[] = [
    '# Deal Execution Pack',
    '',
    `Opportunity: ${opportunityId}`,
    `Title: ${pack.title ?? '—'}`,
    `Deal score: ${pack.deal_score != null ? `${Math.round(pack.deal_score * 100)}%` : '—'}`,
    `Tier: ${(pack.source_tiers ?? []).join(', ') || 'synthetic'}`,
    '',
    '## Parties',
  ];
  const mcr = pack.cargo_records?.[0];
  if (mcr) {
    lines.push(`- Shipper: ${mcr.shipper_name ?? '—'} (LEI: ${mcr.shipper_lei ?? '—'})`);
    lines.push(`- Consignee: ${mcr.consignee_name ?? '—'} (LEI: ${mcr.consignee_lei ?? '—'})`);
    lines.push(
      `- Sanctions: shipper=${mcr.shipper_sanctions_status ?? 'unscreened'} consignee=${mcr.consignee_sanctions_status ?? 'unscreened'}`,
    );
  } else {
    lines.push('- No linked MCR rows');
  }
  lines.push('', '## Route & timing', '');
  if (mcr) {
    lines.push(
      `- ${mcr.load_port_name ?? mcr.load_country ?? '?'} → ${mcr.discharge_hint ?? mcr.discharge_country ?? '?'}`,
    );
    if (mcr.event_date) lines.push(`- Event date: ${mcr.event_date}`);
  }
  lines.push('', '## Disclaimer', '');
  lines.push(
    'Hypothesis from public/open data only — not a confirmed deal or paid BOL. Verify tiers and source URLs before action.',
  );
  lines.push('', `Generated: ${new Date().toISOString()}`);
  return lines.join('\n');
}

export function printDealPack(pack: DealExecutionPack, opportunityId: string): void {
  const md = dealPackToMarkdown(pack, opportunityId);
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return;
  w.document.write(`<pre style="font-family:system-ui;padding:24px;white-space:pre-wrap">${md.replace(/</g, '&lt;')}</pre>`);
  w.document.close();
  w.focus();
  w.print();
}

export function downloadDealPackMarkdown(pack: DealExecutionPack, opportunityId: string): void {
  const md = dealPackToMarkdown(pack, opportunityId);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `madsan-deal-pack-${opportunityId.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
