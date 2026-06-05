import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LucideBell,
  LucideCalculator,
  LucidePackage,
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
  type BrokerDealPack,
  type DealPackEconomics,
  type DealPackJournal,
  type DealPackTransport,
} from '../../api/brokerWorkspaceApi';
import { brokerMapQueryKey } from '../../hooks/use-broker-workspace';

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
  const [econForm, setEconForm] = useState<DealPackEconomics>(economics);
  const [remindAt, setRemindAt] = useState('');
  const [remindTitle, setRemindTitle] = useState('');

  const followupsQuery = useQuery({
    queryKey: ['pack-followups', workspaceId, pack.id],
    queryFn: () => listDealPackFollowups(workspaceId, pack.id),
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

  useEffect(() => {
    setTransportForm(transport);
    setEconForm(economics);
    setStageLabel(journal.stage_label);
    setDoneText(journal.done.join('\n'));
    setMissingText(journal.missing.join('\n'));
    setNotes(journal.notes);
  }, [pack.id, pack.updated_at]);

  const handleSave = () => {
    onSave({
      journal: {
        stage_label: stageLabel,
        done: doneText.split('\n').map((s) => s.trim()).filter(Boolean),
        missing: missingText.split('\n').map((s) => s.trim()).filter(Boolean),
        notes,
      },
      transport: transportForm,
      economics: { ...econForm, calculated_profit: profit, margin_pct: marginPct },
    });
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
          <input
            value={transportForm.vessel_name ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, vessel_name: e.target.value }))}
            placeholder="Vessel name"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
          <input
            value={transportForm.vessel_imo ?? ''}
            onChange={(e) => setTransportForm((t) => ({ ...t, vessel_imo: e.target.value }))}
            placeholder="IMO"
            className="w-full text-sm px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
          />
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
