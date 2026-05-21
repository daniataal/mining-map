import {
  addOilWatchlist,
  saveOilCompanyToSuppliers,
  type OilOpportunity,
  type OilTerminal,
  type OilWatchlistItem,
} from '../../api/oilLiveApi';

export function terminalMatchesSearch(term: OilTerminal, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [term.name, term.country, term.port, term.operator_name, term.city]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export function opportunityWatchTarget(
  opp: OilOpportunity,
): { watch_type: string; watch_ref: string } | null {
  if (opp.terminal_id) {
    return { watch_type: 'terminal', watch_ref: opp.terminal_id };
  }
  if (opp.opportunity_type) {
    return { watch_type: 'opportunity_type', watch_ref: opp.opportunity_type };
  }
  return null;
}

export function isOnWatchlist(
  watches: OilWatchlistItem[],
  watchType: string,
  watchRef: string,
): boolean {
  return watches.some((w) => w.watch_type === watchType && w.watch_ref === watchRef);
}

export async function watchOpportunity(
  opp: OilOpportunity,
  watches: OilWatchlistItem[],
): Promise<{ already: boolean }> {
  const target = opportunityWatchTarget(opp);
  if (!target) {
    throw new Error('No terminal or opportunity type to watch');
  }
  if (isOnWatchlist(watches, target.watch_type, target.watch_ref)) {
    return { already: true };
  }
  await addOilWatchlist({
    watch_type: target.watch_type,
    watch_ref: target.watch_ref,
    label: opp.title ?? opp.id.slice(0, 8),
    min_confidence: opp.confidence ?? 0.55,
  });
  return { already: false };
}

export async function saveCompanyToSuppliers(companyId: string): Promise<{
  status: string;
  supplier_id?: string;
}> {
  return saveOilCompanyToSuppliers(companyId);
}

export function commodityMatchesFilter(
  commodityFamily: string | undefined,
  productFilter: string,
): boolean {
  if (productFilter === 'all') return true;
  const family = (commodityFamily ?? '').toLowerCase();
  return family === productFilter || family.includes(productFilter);
}
