import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LucideBell,
  LucideCalculator,
  LucidePackage,
  LucideRoute,
  LucideShip,
  LucideX,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  calcDealProfit,
  completeDealPackFollowup,
  createDealPackFollowup,
  listDealPackFollowups,
  parsePackEconomics,
  parsePackJournal,
  parsePackTransport,
  searchDealPackVessels,
  type BrokerDealPack,
  type DealPackCostItem,
  type DealPackEconomics,
  type DealPackJournal,
  type DealPackTransport,
  type DealPackVesselHit,
} from '../../api/brokerWorkspaceApi';
import { brokerMapQueryKey } from '../../hooks/use-broker-workspace';
import {
  DEAL_PRODUCT_OPTIONS,
  defaultUnitForDealProduct,
  findDealProductOption,
  unitFitsDealProduct,
  unitsForDealProduct,
} from '../../lib/dealPackTransportOptions';

const COST_CATEGORIES: Array<NonNullable<DealPackCostItem['category']>> = [
  'loading',
  'unloading',
  'port_fee',
  'storage',
  'vessel',
  'inspection',
  'demurrage',
  'other',
];

const CUSTOM_PRODUCT = '__custom_product__';
const CUSTOM_UNIT = '__custom_unit__';

const INCOTERMS = [
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
];

function numberOrUndefined(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

function vesselDisplayName(vessel: DealPackVesselHit): string {
  return vessel.name || (vessel.imo ? `IMO ${vessel.imo}` : `MMSI ${vessel.mmsi}`);
}

function vesselSubtitle(vessel: DealPackVesselHit): string {
  return [
    vessel.imo ? `IMO ${vessel.imo}` : null,
    vessel.mmsi ? `MMSI ${vessel.mmsi}` : null,
    vessel.tanker_class || vessel.vessel_type || null,
    vessel.last_position_at ? `AIS ${new Date(vessel.last_position_at).toLocaleDateString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function newCostItem(category: NonNullable<DealPackCostItem['category']> = 'port_fee'): DealPackCostItem {
  return {
    id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: category.replace('_', ' '),
    amount: 0,
    currency: 'USD',
    category,
  };
}

function formatRouteLegs(transport: DealPackTransport): string {
  return (transport.route_legs ?? [])
    .sort((a, b) => a.sequence - b.sequence)
    .map((leg) => [leg.mode, leg.from, leg.to, leg.hub_name ?? '', leg.notes ?? ''].join(' | '))
    .join('\n');
}

function parseRouteLegs(text: string): DealPackTransport['route_legs'] {
  return text
    .split('\n')
    .map((line, index) => {
      const [modeRaw, fromRaw, toRaw, hubRaw, notesRaw] = line.split('|').map((part) => part.trim());
      if (!modeRaw || !fromRaw || !toRaw) return null;
      const mode = ['truck', 'rail', 'pipeline', 'vessel', 'air'].includes(modeRaw)
        ? (modeRaw as NonNullable<DealPackTransport['route_legs']>[number]['mode'])
        : 'other';
      return {
        sequence: index + 1,
        mode,
        from: fromRaw,
        to: toRaw,
        hub_name: hubRaw || undefined,
        notes: notesRaw || undefined,
      };
    })
    .filter(Boolean) as NonNullable<DealPackTransport['route_legs']>;
}

type Props = {
  workspaceId: string;
  pack: BrokerDealPack;
  entities: Array<{ id: string; display_name: string; entity_type: string }>;
  onClose: () => void;
  onUnpack: () => void;
  onSave: (body: {
    journal?: DealPackJournal;
    transport?: DealPackTransport;
    economics?: DealPackEconomics;
  }) => void;
};

export function DealPackDetailPanel({
  workspaceId,
  pack,
  entities,
  onClose,
  onUnpack,
  onSave,
}: Props) {
  const qc = useQueryClient();
  const journal = parsePackJournal(pack.journal);
  const [stageLabel, setStageLabel] = useState(journal.stage_label);
  const [doneText, setDoneText] = useState(journal.done.join('\n'));
  const [missingText, setMissingText] = useState(journal.missing.join('\n'));
  const [notes, setNotes] = useState(journal.notes);
  const transport = parsePackTransport(pack.transport);
  const economics = parsePackEconomics(pack.economics);
  const [transportForm, setTransportForm] = useState<DealPackTransport>(transport);
  const [routeLegsText, setRouteLegsText] = useState(formatRouteLegs(transport));
  const [econForm, setEconForm] = useState<DealPackEconomics>(economics);
  const [remindAt, setRemindAt] = useState('');
  const [remindTitle, setRemindTitle] = useState('');
  const [customProductMode, setCustomProductMode] = useState(
    Boolean(transport.product && !findDealProductOption(transport.product)),
  );
  const [customUnitMode, setCustomUnitMode] = useState(
    Boolean(transport.unit && !unitFitsDealProduct(transport.product, transport.unit)),
  );
  const [vesselQuery, setVesselQuery] = useState(
    transport.vessel_imo || transport.vessel_name || transport.vessel_mmsi || '',
  );

  const followupsQuery = useQuery({
    queryKey: ['pack-followups', workspaceId, pack.id],
    queryFn: () => listDealPackFollowups(workspaceId, pack.id),
  });

  const vesselSearchQuery = useQuery({
    queryKey: ['deal-pack-vessel-search', vesselQuery.trim()],
    queryFn: () => searchDealPackVessels(vesselQuery.trim(), 6),
    enabled: vesselQuery.trim().length >= 2,
    staleTime: 120_000,
  });

  const addFollowup = useMutation({
    mutationFn: () =>
      createDealPackFollowup(workspaceId, pack.id, {
        remind_at: new Date(remindAt).toISOString(),
        title: remindTitle,
      }),
    onSuccess: () => {
      setRemindAt('');
      setRemindTitle('');
      void qc.invalidateQueries({ queryKey: ['pack-followups', workspaceId, pack.id] });
      void qc.invalidateQueries({ queryKey: brokerMapQueryKey(workspaceId) });
    },
  });

  const completeFollowup = useMutation({
    mutationFn: (fid: string) => completeDealPackFollowup(workspaceId, pack.id, fid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pack-followups', workspaceId, pack.id] });
    },
  });

  const profit = calcDealProfit(econForm);
  const marginPct =
    econForm.sell_price && econForm.buy_price
      ? ((econForm.sell_price - econForm.buy_price) / econForm.buy_price) * 100
      : 0;
  const costItems = econForm.cost_items ?? [];

  useEffect(() => {
    setTransportForm(transport);
    setRouteLegsText(formatRouteLegs(transport));
    setEconForm(economics);
    setStageLabel(journal.stage_label);
    setDoneText(journal.done.join('\n'));
    setMissingText(journal.missing.join('\n'));
    setNotes(journal.notes);
    setCustomProductMode(Boolean(transport.product && !findDealProductOption(transport.product)));
    setCustomUnitMode(Boolean(transport.unit && !unitFitsDealProduct(transport.product, transport.unit)));
    setVesselQuery(transport.vessel_imo || transport.vessel_name || transport.vessel_mmsi || '');
  }, [pack.id, pack.updated_at]);

  const productOption = findDealProductOption(transportForm.product);
  const productSelectValue = customProductMode
    ? CUSTOM_PRODUCT
    : productOption?.id ?? (transportForm.product ? CUSTOM_PRODUCT : '');
  const unitOptions = unitsForDealProduct(transportForm.product);
  const unitSelectValue =
    customUnitMode || (transportForm.unit && !unitOptions.includes(transportForm.unit))
      ? CUSTOM_UNIT
      : transportForm.unit ?? '';

  const applyProductOption = (optionId: string) => {
    if (optionId === CUSTOM_PRODUCT) {
      setCustomProductMode(true);
      return;
    }
    const option = DEAL_PRODUCT_OPTIONS.find((item) => item.id === optionId);
    if (!option) return;
    setCustomProductMode(false);
    setCustomUnitMode(false);
    setTransportForm((current) => ({
      ...current,
      product: option.label,
      unit: current.unit && option.units.includes(current.unit) ? current.unit : option.defaultUnit,
    }));
  };

  const applyVessel = (vessel: DealPackVesselHit) => {
    setVesselQuery(vesselDisplayName(vessel));
    setTransportForm((current) => ({
      ...current,
      mode: 'vessel',
      vessel_name: vessel.name || current.vessel_name,
      vessel_imo: vessel.imo || current.vessel_imo,
      vessel_mmsi: String(vessel.mmsi || current.vessel_mmsi || ''),
      vessel_call_sign: vessel.callsign || current.vessel_call_sign,
      vessel_type: vessel.vessel_type || current.vessel_type,
      vessel_tanker_class: vessel.tanker_class || current.vessel_tanker_class,
      vessel_deadweight_tons: vessel.deadweight_tons ?? current.vessel_deadweight_tons,
      vessel_max_draft_m: vessel.max_draft_m ?? current.vessel_max_draft_m,
      vessel_flag: vessel.flag || current.vessel_flag,
      vessel_last_lat: vessel.lat ?? current.vessel_last_lat,
      vessel_last_lng: vessel.lng ?? current.vessel_last_lng,
      vessel_last_position_at: vessel.last_position_at || current.vessel_last_position_at,
      vessel_destination: vessel.destination || current.vessel_destination,
      vessel_speed_knots: vessel.speed_knots ?? current.vessel_speed_knots,
      vessel_draft_m: vessel.draft_m ?? current.vessel_draft_m,
      vessel_crude_capable: vessel.crude_capable ?? current.vessel_crude_capable,
      vessel_product_tanker: vessel.product_tanker ?? current.vessel_product_tanker,
      port_name: current.port_name || vessel.destination || undefined,
    }));
  };

  const handleSave = () => {
    onSave({
      journal: {
        stage_label: stageLabel,
        done: doneText.split('\n').map((s) => s.trim()).filter(Boolean),
        missing: missingText.split('\n').map((s) => s.trim()).filter(Boolean),
        notes,
      },
      transport: { ...transportForm, route_legs: parseRouteLegs(routeLegsText) },
      economics: { ...econForm, calculated_profit: profit, margin_pct: marginPct },
    });
  };

  const updateCostItem = (itemId: string, patch: Partial<DealPackCostItem>) => {
    setEconForm((form) => ({
      ...form,
      cost_items: (form.cost_items ?? []).map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    }));
  };

  const addCostItem = (category: NonNullable<DealPackCostItem['category']>) => {
    setEconForm((form) => ({
      ...form,
      cost_items: [...(form.cost_items ?? []), newCostItem(category)],
    }));
  };

  const removeCostItem = (itemId: string) => {
    setEconForm((form) => ({
      ...form,
      cost_items: (form.cost_items ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const constituents = entities.filter((e) => pack.constituent_entity_ids.includes(e.id));

  return (
    <div className="h-full flex flex-col bg-stone-100 dark:bg-slate-900 border-l border-black/10 dark:border-white/10 shadow-2xl">
      <div className="shrink-0 p-4 border-b border-black/5 dark:border-white/5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
            <LucidePackage className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black truncate">{pack.name}</h2>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">{pack.status}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-200">
          <LucideX className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Constituents</h3>
          <ul className="space-y-1 text-sm">
            {constituents.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="font-semibold truncate">{c.display_name}</span>
                <span className="text-[10px] uppercase text-slate-400">{c.entity_type}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Deal journal</h3>
          <input
            value={stageLabel}
            onChange={(e) => setStageLabel(e.target.value)}
            placeholder="Current stage (e.g. Negotiation, Logistics)"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <textarea
            value={doneText}
            onChange={(e) => setDoneText(e.target.value)}
            placeholder="Done (one per line)"
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <textarea
            value={missingText}
            onChange={(e) => setMissingText(e.target.value)}
            placeholder="Missing (one per line)"
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            rows={2}
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Transport & infrastructure</h3>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={productSelectValue}
              onChange={(e) => applyProductOption(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            >
              <option value="">Product</option>
              {DEAL_PRODUCT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              <option value={CUSTOM_PRODUCT}>Custom product</option>
            </select>
            <input
              type="number"
              value={transportForm.quantity ?? ''}
              onChange={(e) =>
                setTransportForm((t) => ({
                  ...t,
                  quantity: numberOrUndefined(e.target.value),
                }))
              }
              placeholder="Quantity"
              className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            {customProductMode && (
              <input
                value={transportForm.product ?? ''}
                onChange={(e) =>
                  setTransportForm((t) => ({
                    ...t,
                    product: e.target.value,
                    unit: t.unit || defaultUnitForDealProduct(e.target.value),
                  }))
                }
                placeholder="Custom product"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
            )}
            <select
              value={unitSelectValue}
              onChange={(e) => {
                if (e.target.value === CUSTOM_UNIT) {
                  setCustomUnitMode(true);
                  return;
                }
                setCustomUnitMode(false);
                setTransportForm((t) => ({ ...t, unit: e.target.value || undefined }));
              }}
              className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            >
              <option value="">Unit</option>
              {unitOptions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
              <option value={CUSTOM_UNIT}>Custom unit</option>
            </select>
            {customUnitMode && (
              <input
                value={transportForm.unit ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, unit: e.target.value }))}
                placeholder="Custom unit"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
            )}
          </div>
          <select
            value={transportForm.incoterm ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, incoterm: e.target.value || undefined }))}
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          >
            <option value="">Incoterm</option>
            {INCOTERMS.map((term) => (
              <option key={term} value={term}>
                {term}
              </option>
            ))}
          </select>
          <select
            value={transportForm.mode ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, mode: e.target.value }))}
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          >
            <option value="">Transport mode</option>
            <option value="vessel">Vessel</option>
            <option value="pipeline">Pipeline</option>
            <option value="truck">Truck</option>
            <option value="rail">Rail</option>
          </select>
          <div className="space-y-2 rounded-xl border border-black/10 p-2 dark:border-white/10">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <LucideShip className="w-3.5 h-3.5" />
              Vessel lookup
            </h4>
            <input
              value={vesselQuery}
              onChange={(e) => {
                setVesselQuery(e.target.value);
                setTransportForm((t) => ({ ...t, vessel_name: e.target.value }));
              }}
              placeholder="Search vessel by name, IMO, MMSI or call sign"
              className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            {vesselSearchQuery.isFetching && (
              <p className="text-[10px] text-slate-500">Searching vessel registry...</p>
            )}
            {(vesselSearchQuery.data?.vessels ?? []).length > 0 && (
              <div className="space-y-1">
                {vesselSearchQuery.data!.vessels.map((vessel) => (
                  <button
                    key={`${vessel.mmsi}-${vessel.imo ?? ''}`}
                    type="button"
                    onClick={() => applyVessel(vessel)}
                    className="w-full rounded-lg border border-black/10 px-2 py-1.5 text-left hover:border-amber-500/40 hover:bg-amber-500/10 dark:border-white/10"
                  >
                    <span className="block truncate text-xs font-black">{vesselDisplayName(vessel)}</span>
                    <span className="block truncate text-[10px] text-slate-500">{vesselSubtitle(vessel)}</span>
                  </button>
                ))}
              </div>
            )}
            {vesselQuery.trim().length >= 2 && !vesselSearchQuery.isFetching && vesselSearchQuery.data?.vessels.length === 0 && (
              <p className="text-[10px] text-slate-500">
                No vessel match found. Keep the manually entered vessel details if this is private or not covered.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input
                value={transportForm.vessel_name ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_name: e.target.value }))}
                placeholder="Vessel name"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_imo ?? ''}
                onChange={(e) => {
                  setVesselQuery(e.target.value);
                  setTransportForm((t) => ({ ...t, vessel_imo: e.target.value }));
                }}
                placeholder="IMO"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_mmsi ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_mmsi: e.target.value }))}
                placeholder="MMSI"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_call_sign ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_call_sign: e.target.value }))}
                placeholder="Call sign"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_type ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_type: e.target.value }))}
                placeholder="Vessel type"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_tanker_class ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_tanker_class: e.target.value }))}
                placeholder="Tanker class"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                type="number"
                value={transportForm.vessel_deadweight_tons ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_deadweight_tons: numberOrUndefined(e.target.value) }))}
                placeholder="DWT"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                type="number"
                value={transportForm.vessel_max_draft_m ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_max_draft_m: numberOrUndefined(e.target.value) }))}
                placeholder="Max draft m"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_flag ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_flag: e.target.value }))}
                placeholder="Flag"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_last_position_at ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_last_position_at: e.target.value }))}
                placeholder="Last AIS position time"
                className="text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
              <input
                value={transportForm.vessel_destination ?? ''}
                onChange={(e) => setTransportForm((t) => ({ ...t, vessel_destination: e.target.value }))}
                placeholder="AIS destination"
                className="col-span-2 text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
            </div>
            <p className="text-[9px] leading-snug text-slate-500">
              Vessel data is prefilled from stored AIS/registry records when found. Coverage gaps mean no match is not proof that the vessel does not exist.
            </p>
          </div>
          <input
            value={transportForm.port_name ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, port_name: e.target.value }))}
            placeholder="Destination port"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <input
            value={transportForm.terminal_id ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, terminal_id: e.target.value }))}
            placeholder="Tank / terminal ID"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <input
            value={transportForm.refinery_id ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, refinery_id: e.target.value }))}
            placeholder="Refinery ID"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <input
            value={transportForm.pipeline_id ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, pipeline_id: e.target.value }))}
            placeholder="Pipeline ID"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <div className="space-y-1">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <LucideRoute className="w-3.5 h-3.5" />
              Ordered route legs
            </h4>
            <textarea
              value={routeLegsText}
              onChange={(e) => setRouteLegsText(e.target.value)}
              placeholder={'truck | Supplier site | Export port | Tema | Inland haul\nvessel | Export port | Buyer port | | Ocean leg'}
              rows={4}
              className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            <p className="text-[9px] leading-snug text-slate-500">
              Format: mode | from | to | hub | notes. Modes: truck, rail, pipeline, vessel, air, other.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
            <LucideCalculator className="w-3.5 h-3.5" /> Profit
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(['buy_price', 'sell_price', 'volume', 'freight_cost', 'misc_costs'] as const).map((key) => (
              <input
                key={key}
                type="number"
                value={econForm[key] ?? ''}
                onChange={(e) =>
                  setEconForm((f) => ({ ...f, [key]: e.target.value ? Number(e.target.value) : undefined }))
                }
                placeholder={key.replace('_', ' ')}
                className="text-sm px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              />
            ))}
          </div>
          <div className="space-y-2 rounded-xl border border-black/10 p-2 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Itemized route costs
              </h4>
              <select
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-[10px] dark:border-white/10"
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  addCostItem(event.target.value as NonNullable<DealPackCostItem['category']>);
                  event.target.value = '';
                }}
              >
                <option value="">Add cost</option>
                {COST_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            {costItems.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                Add port loading, unloading, storage, vessel, inspection or demurrage costs.
              </p>
            ) : (
              <div className="space-y-2">
                {costItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_5rem_4rem_auto] gap-1">
                    <input
                      value={item.label}
                      onChange={(event) => updateCostItem(item.id, { label: event.target.value })}
                      placeholder="Cost label"
                      className="min-w-0 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/10"
                    />
                    <input
                      type="number"
                      value={item.amount || ''}
                      onChange={(event) =>
                        updateCostItem(item.id, {
                          amount: event.target.value ? Number(event.target.value) : 0,
                        })
                      }
                      placeholder="Amount"
                      className="min-w-0 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/10"
                    />
                    <input
                      value={item.currency ?? 'USD'}
                      onChange={(event) => updateCostItem(item.id, { currency: event.target.value })}
                      placeholder="USD"
                      className="min-w-0 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => removeCostItem(item.id)}
                      className="rounded-lg px-2 text-xs font-black text-slate-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {constituents.length > 0 && costItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  Attach cost to facility
                </p>
                {costItems.map((item) => (
                  <select
                    key={`${item.id}-entity`}
                    value={item.entity_id ?? ''}
                    onChange={(event) =>
                      updateCostItem(item.id, { entity_id: event.target.value || undefined })
                    }
                    className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/10"
                  >
                    <option value="">{item.label || 'Cost'} · no linked asset</option>
                    {constituents.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {item.label || 'Cost'} · {entity.display_name}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            )}
          </div>
          <p className="text-sm font-bold text-emerald-600">
            Calculated profit: {profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {marginPct ? ` (${marginPct.toFixed(1)}% margin)` : ''}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
            <LucideBell className="w-3.5 h-3.5" /> Follow-ups
          </h3>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            <input
              value={remindTitle}
              onChange={(e) => setRemindTitle(e.target.value)}
              placeholder="Title"
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            <Button
              size="sm"
              disabled={!remindAt || !remindTitle}
              onClick={() => addFollowup.mutate()}
            >
              Add
            </Button>
          </div>
          <ul className="space-y-1 text-xs">
            {(followupsQuery.data?.followups ?? []).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/5 dark:bg-white/5">
                <span className={f.completed_at ? 'line-through opacity-50' : ''}>
                  {f.title} — {new Date(f.remind_at).toLocaleString()}
                </span>
                {!f.completed_at && (
                  <button
                    type="button"
                    className="text-emerald-600 font-bold"
                    onClick={() => completeFollowup.mutate(f.id)}
                  >
                    Done
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="shrink-0 p-4 border-t border-black/5 dark:border-white/5 flex gap-2">
        <Button className="flex-1" onClick={handleSave}>
          Save pack
        </Button>
        {pack.status === 'packed' && (
          <Button variant="outline" onClick={onUnpack}>
            Unpack
          </Button>
        )}
      </div>
    </div>
  );
}
