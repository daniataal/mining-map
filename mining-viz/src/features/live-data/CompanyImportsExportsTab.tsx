import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ArrowRightLeft, Crosshair, ExternalLink, Inbox, Send } from 'lucide-react';
import {
  getCargoRecords,
  getCompanyShipments,
  type MeridianCargoRecord,
} from '../../api/oilLiveApi';
import { getEiaHistoricSummary } from '../../api/eiaHistoricApi';
import { firstVerifyUrl } from '../../lib/verifySourceUrl';
import {
  bezierMidpoint,
  commodityColor,
  type LatLngTuple,
} from '../../lib/corridorGeometry';
import { useI18n } from '../../lib/i18n';

export type CompanyImportsExportsHighlight = {
  companyName?: string;
  companyId?: string;
  terminalId?: string;
  terminalName?: string;
  corridor?: {
    load: LatLngTuple;
    discharge: LatLngTuple;
    commodity_family?: string;
  };
};

export type CompanyImportsExportsTabProps = {
  entityKind: 'company' | 'terminal';
  entityId: string;
  entityName?: string;
  /** When defined, the "Highlight on map" buttons emit selection details. */
  onHighlightOnMap?: (selection: CompanyImportsExportsHighlight) => void;
  /** Open a specific contributing MCR in the cargo drawer. */
  onCargoClick?: (cargoId: string) => void;
};

type CounterpartyRow = {
  name: string;
  role: 'consignee' | 'shipper' | 'partner';
  cargoCount: number;
  volume: number;
  unit: string;
  lastEvent?: string;
};

type CorridorRow = {
  key: string;
  load: LatLngTuple;
  discharge: LatLngTuple;
  loadLabel: string;
  dischargeLabel: string;
  commodity_family?: string;
  cargoCount: number;
  sampleId: string;
};

type YearlyRow = {
  year: number;
  cargoCount: number;
  volume: number;
};

function matchesCompany(record: MeridianCargoRecord, focusId: string, focusName?: string): 'shipper' | 'consignee' | null {
  if (record.shipper_company_id && record.shipper_company_id === focusId) return 'shipper';
  if (record.consignee_company_id && record.consignee_company_id === focusId) return 'consignee';
  if (focusName) {
    const f = focusName.trim().toLowerCase();
    if (f) {
      if ((record.shipper_name ?? '').toLowerCase() === f) return 'shipper';
      if ((record.consignee_name ?? '').toLowerCase() === f) return 'consignee';
    }
  }
  return null;
}

function matchesTerminal(record: MeridianCargoRecord, terminalName?: string): boolean {
  if (!terminalName) return false;
  const tn = terminalName.trim().toLowerCase();
  if (!tn) return false;
  return (
    (record.load_port_name ?? '').toLowerCase().includes(tn) ||
    (record.discharge_hint ?? '').toLowerCase().includes(tn)
  );
}

function formatVolume(value: number, unit?: string): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M ${unit ?? ''}`.trim();
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K ${unit ?? ''}`.trim();
  return `${Math.round(value)} ${unit ?? ''}`.trim();
}

export default function CompanyImportsExportsTab({
  entityKind,
  entityId,
  entityName,
  onHighlightOnMap,
  onCargoClick,
}: CompanyImportsExportsTabProps) {
  const { t } = useI18n();

  const { data: shipmentData, isLoading: shipmentsLoading, error: shipmentsError } = useQuery({
    queryKey: ['oil-live-company-shipments', entityId],
    queryFn: () => getCompanyShipments(entityId, { limit: 100 }),
    enabled: entityKind === 'company' && Boolean(entityId),
    staleTime: 60_000,
  });

  const { data: terminalCargo, isLoading: terminalLoading, error: terminalError } = useQuery({
    queryKey: ['oil-live-terminal-cargo', entityId, entityName ?? ''],
    queryFn: () => getCargoRecords({ limit: 200, min_confidence: 0.4 }),
    enabled: entityKind === 'terminal' && Boolean(entityId),
    staleTime: 60_000,
  });

  const { data: eiaSummary } = useQuery({
    queryKey: ['eia-historic-company', entityName ?? ''],
    queryFn: () => getEiaHistoricSummary({ importer: entityName!.trim(), year_from: 2015 }),
    enabled: entityKind === 'company' && Boolean(entityName?.trim()),
    staleTime: 120_000,
  });

  const isLoading = entityKind === 'company' ? shipmentsLoading : terminalLoading;
  const error = entityKind === 'company' ? shipmentsError : terminalError;

  const rows = useMemo<MeridianCargoRecord[]>(() => {
    if (entityKind === 'company') {
      return shipmentData?.shipments ?? [];
    }
    const all = terminalCargo?.cargo_records ?? [];
    return all.filter((r) => matchesTerminal(r, entityName));
  }, [entityKind, shipmentData?.shipments, terminalCargo?.cargo_records, entityName]);

  const counterparties = useMemo<CounterpartyRow[]>(() => {
    if (entityKind !== 'company') return [];
    const acc = new Map<string, CounterpartyRow>();
    for (const r of rows) {
      const side = matchesCompany(r, entityId, entityName);
      let otherName: string | undefined;
      let role: CounterpartyRow['role'] = 'partner';
      if (side === 'shipper') {
        otherName = r.consignee_name;
        role = 'consignee';
      } else if (side === 'consignee') {
        otherName = r.shipper_name;
        role = 'shipper';
      }
      if (!otherName) continue;
      const key = otherName.toLowerCase();
      const entry = acc.get(key) ?? {
        name: otherName,
        role,
        cargoCount: 0,
        volume: 0,
        unit: r.volume_unit ?? 'bbl',
        lastEvent: undefined,
      };
      entry.cargoCount += 1;
      if (r.volume_best_estimate != null) entry.volume += r.volume_best_estimate;
      if (r.event_date && (!entry.lastEvent || r.event_date > entry.lastEvent)) {
        entry.lastEvent = r.event_date;
      }
      acc.set(key, entry);
    }
    return [...acc.values()].sort(
      (a, b) => b.cargoCount - a.cargoCount || b.volume - a.volume,
    );
  }, [rows, entityKind, entityId, entityName]);

  const corridors = useMemo<CorridorRow[]>(() => {
    const acc = new Map<string, CorridorRow>();
    for (const r of rows) {
      if (
        r.corridor_load_lat == null ||
        r.corridor_load_lng == null ||
        r.corridor_discharge_lat == null ||
        r.corridor_discharge_lng == null
      ) {
        continue;
      }
      const load: LatLngTuple = [r.corridor_load_lat, r.corridor_load_lng];
      const disc: LatLngTuple = [r.corridor_discharge_lat, r.corridor_discharge_lng];
      const key = `${load[0].toFixed(2)},${load[1].toFixed(2)}|${disc[0].toFixed(2)},${disc[1].toFixed(2)}|${r.commodity_family ?? ''}`;
      const entry = acc.get(key) ?? {
        key,
        load,
        discharge: disc,
        loadLabel:
          r.load_port_name ??
          (r.load_country ? r.load_country : `${load[0].toFixed(1)},${load[1].toFixed(1)}`),
        dischargeLabel:
          r.discharge_hint ??
          r.discharge_country ??
          `${disc[0].toFixed(1)},${disc[1].toFixed(1)}`,
        commodity_family: r.commodity_family,
        cargoCount: 0,
        sampleId: r.id,
      };
      entry.cargoCount += 1;
      acc.set(key, entry);
    }
    return [...acc.values()].sort((a, b) => b.cargoCount - a.cargoCount).slice(0, 5);
  }, [rows]);

  const yearly = useMemo<YearlyRow[]>(() => {
    const acc = new Map<number, YearlyRow>();
    for (const r of rows) {
      const dateStr = r.event_date ?? r.created_at;
      if (!dateStr) continue;
      const ts = Date.parse(dateStr);
      if (!Number.isFinite(ts)) continue;
      const year = new Date(ts).getUTCFullYear();
      const entry = acc.get(year) ?? { year, cargoCount: 0, volume: 0 };
      entry.cargoCount += 1;
      if (r.volume_best_estimate != null) entry.volume += r.volume_best_estimate;
      acc.set(year, entry);
    }
    return [...acc.values()].sort((a, b) => a.year - b.year);
  }, [rows]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-[11px] text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('טוען היסטוריית סחר…', 'Loading trade history…')}
      </div>
    );
  }
  if (error) {
    return (
      <p className="p-3 text-[11px] text-red-500">
        {error instanceof Error ? error.message : t('שגיאה', 'Failed to load')}
      </p>
    );
  }

  const exportsCount = entityKind === 'company'
    ? rows.filter((r) => matchesCompany(r, entityId, entityName) === 'shipper').length
    : 0;
  const importsCount = entityKind === 'company'
    ? rows.filter((r) => matchesCompany(r, entityId, entityName) === 'consignee').length
    : 0;

  return (
    <div className="space-y-4 text-[11px]">
      <header className="space-y-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-violet-500 flex items-center gap-1">
          <ArrowRightLeft className="w-3 h-3" />
          {t('יבוא ויצוא', 'Imports & Exports')}
        </p>
        {entityKind === 'company' ? (
          <p className="text-[10px] text-slate-500">
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {exportsCount}
            </span>{' '}
            <Send className="inline w-3 h-3" /> {t('יצוא', 'exports')} ·{' '}
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {importsCount}
            </span>{' '}
            <Inbox className="inline w-3 h-3" /> {t('יבוא', 'imports')}
          </p>
        ) : (
          <p className="text-[10px] text-slate-500">
            {rows.length} {t('רשומות מטען בקרבת המסוף', 'cargo records near terminal')}
          </p>
        )}
        {onHighlightOnMap && (
          <button
            type="button"
            onClick={() =>
              onHighlightOnMap(
                entityKind === 'company'
                  ? { companyId: entityId, companyName: entityName }
                  : { terminalId: entityId, terminalName: entityName },
              )
            }
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
          >
            <Crosshair className="w-3.5 h-3.5" />
            {t('הדגש במפה', 'Highlight on map')}
          </button>
        )}
      </header>

      {entityKind === 'company' && eiaSummary && eiaSummary.row_count > 0 && (
        <section className="rounded-lg border border-purple-500/25 bg-purple-500/5 px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-1">
            {t('היסטוריית EIA (מאקרו)', 'EIA historic imports (macro)')}
          </p>
          <p className="text-[10px] text-slate-600 dark:text-slate-300">
            {eiaSummary.row_count} {t('שורות', 'rows')} ·{' '}
            {eiaSummary.year_min ?? '—'}–{eiaSummary.year_max ?? '—'}
          </p>
          {eiaSummary.top_origins.length > 0 && (
            <ul className="mt-1 text-[10px] text-slate-700 dark:text-slate-200 space-y-0.5">
              {eiaSummary.top_origins.slice(0, 4).map((o) => (
                <li key={o.origin_country}>
                  {o.origin_country}: {(o.volume_bbl / 1e6).toFixed(1)}M bbl
                </li>
              ))}
            </ul>
          )}
          <p className="text-[9px] text-slate-500 mt-1">{eiaSummary.provenance ?? 'EIA impa — historic tier'}</p>
        </section>
      )}

      {rows.length > 0 && (
        <section>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
            {t('פנקס משלוחים', 'Shipment ledger')}
            {entityKind === 'company' && shipmentData?.total != null && (
              <span className="font-normal normal-case text-slate-400">
                {' '}
                ({rows.length}/{shipmentData.total})
              </span>
            )}
          </p>
          <ul className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
            {rows.slice(0, 25).map((r) => {
              const verify = firstVerifyUrl(r);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-black/5 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 px-2 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-800 dark:text-slate-100 text-[10px]">
                      {r.shipper_name ?? '—'} → {r.consignee_name ?? '—'}
                    </p>
                    <p className="text-[9px] text-slate-500">
                      {r.commodity_family ?? '—'} · {r.event_date?.slice(0, 10) ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="rounded px-1 py-0.5 text-[8px] font-black uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {r.bol_tier ?? 'inferred'}
                    </span>
                    {verify && (
                      <a
                        href={verify}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-600 dark:text-violet-400"
                        title={t('אמת במקור', 'Verify at source')}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {onCargoClick && (
                      <button
                        type="button"
                        onClick={() => onCargoClick(r.id)}
                        className="text-[9px] font-black uppercase text-amber-700 dark:text-amber-300"
                      >
                        {t('פתח', 'Open')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-stone-100/40 dark:bg-slate-900/30 p-3 text-[10px] text-slate-500">
          {t(
            'אין רשומות מטען תואמות זמינות כרגע. נתונים חדשים יופיעו כאשר העורף ישלים אותם.',
            'No matching cargo records yet. New records will appear as the backend enriches them.',
          )}
        </p>
      ) : (
        <>
          {counterparties.length > 0 && (
            <section>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                {t('צדדים מובילים', 'Top counterparties')}
              </p>
              <ul className="space-y-1">
                {counterparties.slice(0, 6).map((cp) => (
                  <li
                    key={cp.name}
                    className="flex items-center justify-between gap-2 rounded-md border border-black/5 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-800 dark:text-slate-100">
                        {cp.name}
                      </p>
                      <p className="text-[9px] uppercase text-slate-500 font-bold">
                        {cp.role === 'shipper'
                          ? t('שולח', 'shipper')
                          : cp.role === 'consignee'
                            ? t('נמען', 'consignee')
                            : t('שותף', 'partner')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[10px] text-slate-700 dark:text-slate-200">
                        {cp.cargoCount} · {formatVolume(cp.volume, cp.unit)}
                      </p>
                      {cp.lastEvent && (
                        <p className="text-[9px] text-slate-400">
                          {new Date(cp.lastEvent).toISOString().slice(0, 10)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {corridors.length > 0 && (
            <section>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                {t('מסדרונות מובילים', 'Top corridors')}
              </p>
              <ul className="space-y-1">
                {corridors.map((corr) => (
                  <li
                    key={corr.key}
                    className="flex items-center gap-2 rounded-md border border-black/5 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 px-2 py-1.5"
                  >
                    <CorridorMiniArrow
                      load={corr.load}
                      discharge={corr.discharge}
                      color={commodityColor(corr.commodity_family)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-800 dark:text-slate-100">
                        {corr.loadLabel} → {corr.dischargeLabel}
                      </p>
                      <p className="text-[9px] uppercase text-slate-500 font-bold">
                        {corr.commodity_family ?? t('לא ידוע', 'unknown')} · {corr.cargoCount}{' '}
                        {t('מטענים', 'cargoes')}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {onCargoClick && (
                        <button
                          type="button"
                          onClick={() => onCargoClick(corr.sampleId)}
                          className="rounded-md border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                        >
                          {t('פתח', 'Open')}
                        </button>
                      )}
                      {onHighlightOnMap && (
                        <button
                          type="button"
                          onClick={() =>
                            onHighlightOnMap({
                              companyId: entityKind === 'company' ? entityId : undefined,
                              companyName: entityKind === 'company' ? entityName : undefined,
                              terminalId: entityKind === 'terminal' ? entityId : undefined,
                              terminalName: entityKind === 'terminal' ? entityName : undefined,
                              corridor: {
                                load: corr.load,
                                discharge: corr.discharge,
                                commodity_family: corr.commodity_family,
                              },
                            })
                          }
                          className="rounded-md border border-violet-500/40 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
                        >
                          {t('מפה', 'Map')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {yearly.length > 0 && (
            <section>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                {t('היסטוריה שנתית', 'Year-over-year')}
              </p>
              <YearlySparkline rows={yearly} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CorridorMiniArrow({
  load,
  discharge,
  color,
}: {
  load: LatLngTuple;
  discharge: LatLngTuple;
  color: string;
}) {
  const [a, mid, b] = bezierMidpoint(load, discharge, 0);
  // Normalise into a 40x14 viewport.
  const lats = [a[0], mid[0], b[0]];
  const lngs = [a[1], mid[1], b[1]];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const w = 40;
  const h = 14;
  const project = (lat: number, lng: number): [number, number] => {
    const x = maxLng === minLng ? w / 2 : ((lng - minLng) / (maxLng - minLng)) * (w - 4) + 2;
    const y =
      maxLat === minLat
        ? h / 2
        : h - 2 - ((lat - minLat) / (maxLat - minLat)) * (h - 4);
    return [x, y];
  };
  const p1 = project(a[0], a[1]);
  const pm = project(mid[0], mid[1]);
  const p2 = project(b[0], b[1]);
  const d = `M ${p1[0]},${p1[1]} Q ${pm[0]},${pm[1]} ${p2[0]},${p2[1]}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <circle cx={p1[0]} cy={p1[1]} r={1.5} fill={color} />
      <polygon
        points={`${p2[0]},${p2[1]} ${p2[0] - 3},${p2[1] - 2} ${p2[0] - 3},${p2[1] + 2}`}
        fill={color}
      />
    </svg>
  );
}

function YearlySparkline({ rows }: { rows: YearlyRow[] }) {
  if (rows.length < 1) return null;
  const maxVol = Math.max(1, ...rows.map((r) => r.volume));
  const maxCount = Math.max(1, ...rows.map((r) => r.cargoCount));
  const w = 280;
  const h = 56;
  const barWidth = Math.min(28, Math.max(10, w / (rows.length * 2 + 1)));
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${w} ${h + 14}`}
        className="w-full max-w-md h-auto text-slate-600 dark:text-slate-300"
        role="img"
        aria-label="Cargo count and volume by year"
      >
        {rows.map((row, i) => {
          const x = 8 + i * (barWidth * 2 + 6);
          const countH = (row.cargoCount / maxCount) * h;
          const volH = (row.volume / maxVol) * h;
          return (
            <g key={row.year}>
              <rect
                x={x}
                y={h - countH}
                width={barWidth}
                height={Math.max(countH, 1)}
                className="fill-violet-500/70"
                rx={1}
              />
              <rect
                x={x + barWidth + 2}
                y={h - volH}
                width={barWidth}
                height={Math.max(volH, 1)}
                className="fill-amber-500/70"
                rx={1}
              />
              <text
                x={x + barWidth}
                y={h + 12}
                textAnchor="middle"
                className="fill-current text-[8px]"
              >
                {row.year}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-3 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-violet-500/70" />
          Cargoes
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/70" />
          Volume
        </span>
      </div>
    </div>
  );
}
