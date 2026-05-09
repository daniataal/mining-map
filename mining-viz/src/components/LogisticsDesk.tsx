import { useState, useCallback } from 'react';
import { ShipmentLeg, ShipmentStatus, MiningLicense } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import {
  Plus, Pencil, Trash2, X, Check, Truck, Package,
  MapPin, ArrowRight, AlertTriangle, Anchor,
} from 'lucide-react';
import { toast } from 'sonner';

const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];

const STATUS_CONFIG: Record<ShipmentStatus, { label: string; color: string; icon: React.ReactNode }> = {
  planned:    { label: 'Planned',    color: 'bg-slate-500/20 text-slate-400 border-slate-500/20',    icon: <Package className="w-3 h-3" /> },
  'in-transit': { label: 'In Transit', color: 'bg-blue-500/20 text-blue-400 border-blue-500/20',    icon: <Truck className="w-3 h-3" /> },
  delivered:  { label: 'Delivered',  color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20', icon: <Check className="w-3 h-3" /> },
  cancelled:  { label: 'Cancelled',  color: 'bg-red-500/20 text-red-400 border-red-500/20',         icon: <X className="w-3 h-3" /> },
};

const STORAGE_KEY = 'mining_logistics_shipments';

function loadShipments(): ShipmentLeg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function persistShipments(legs: ShipmentLeg[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(legs));
}

const EMPTY_FORM: Omit<ShipmentLeg, 'id' | 'createdAt'> = {
  dealId: '',
  dealLabel: '',
  origin: '',
  destination: '',
  incoterm: 'FOB',
  status: 'planned',
  eta: '',
  notes: '',
};

interface ShipmentFormProps {
  initial?: Partial<Omit<ShipmentLeg, 'id' | 'createdAt'>>;
  licenses: MiningLicense[];
  onSave: (data: Omit<ShipmentLeg, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}

function ShipmentForm({ initial, licenses, onSave, onCancel }: ShipmentFormProps) {
  const [form, setForm] = useState<Omit<ShipmentLeg, 'id' | 'createdAt'>>({ ...EMPTY_FORM, ...initial });

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (!form.origin.trim() || !form.destination.trim()) {
      toast.error('Origin and destination are required');
      return;
    }
    onSave(form);
  };

  const inputCls = 'w-full text-xs bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:border-amber-400 transition-colors';
  const labelCls = 'text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1';

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 grid grid-cols-2 gap-3">
        {/* Link to deal */}
        <div className="col-span-2">
          <p className={labelCls}>Linked Deal / License</p>
          <select
            className={inputCls}
            value={form.dealId}
            onChange={e => {
              const lic = licenses.find(l => l.id === e.target.value);
              set('dealId', e.target.value);
              if (lic) set('dealLabel', lic.company);
            }}
          >
            <option value="">— Select license / deal (optional) —</option>
            {licenses.map(l => (
              <option key={l.id} value={l.id}>{l.company} — {l.commodity}</option>
            ))}
          </select>
        </div>

        <div>
          <p className={labelCls}>Origin *</p>
          <input className={inputCls} placeholder="e.g. Accra, GH" value={form.origin} onChange={e => set('origin', e.target.value)} />
        </div>
        <div>
          <p className={labelCls}>Destination *</p>
          <input className={inputCls} placeholder="e.g. Dubai, AE" value={form.destination} onChange={e => set('destination', e.target.value)} />
        </div>

        <div>
          <p className={labelCls}>Incoterm</p>
          <select className={inputCls} value={form.incoterm} onChange={e => set('incoterm', e.target.value)}>
            {INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <p className={labelCls}>Status</p>
          <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value as ShipmentStatus)}>
            {(['planned', 'in-transit', 'delivered', 'cancelled'] as ShipmentStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
        </div>

        <div>
          <p className={labelCls}>ETA</p>
          <input className={inputCls} type="date" value={form.eta || ''} onChange={e => set('eta', e.target.value)} />
        </div>
        <div>
          <p className={labelCls}>Deal / Custom label</p>
          <input className={inputCls} placeholder="e.g. Q2 Gold Lot 1" value={form.dealLabel || ''} onChange={e => set('dealLabel', e.target.value)} />
        </div>

        <div className="col-span-2">
          <p className={labelCls}>Notes</p>
          <textarea
            className={`${inputCls} resize-none h-20`}
            placeholder="Freight forwarder, customs broker, PO reference..."
            value={form.notes || ''}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        <div className="col-span-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} className="text-slate-400">Cancel</Button>
          <Button size="sm" onClick={handleSave} className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black uppercase tracking-widest">
            <Check className="w-3.5 h-3.5 mr-1.5" /> Save Shipment
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface LogisticsDeskProps {
  licenses: MiningLicense[];
}

export default function LogisticsDesk({ licenses }: LogisticsDeskProps) {
  const [shipments, setShipments] = useState<ShipmentLeg[]>(loadShipments);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ShipmentStatus | 'all'>('all');

  const persist = useCallback((legs: ShipmentLeg[]) => {
    setShipments(legs);
    persistShipments(legs);
  }, []);

  const addShipment = (data: Omit<ShipmentLeg, 'id' | 'createdAt'>) => {
    const leg: ShipmentLeg = { ...data, id: `leg-${Date.now()}`, createdAt: new Date().toISOString() };
    persist([leg, ...shipments]);
    setShowForm(false);
    toast.success('Shipment leg added');
  };

  const updateShipment = (id: string, data: Omit<ShipmentLeg, 'id' | 'createdAt'>) => {
    persist(shipments.map(s => s.id === id ? { ...s, ...data } : s));
    setEditId(null);
    toast.success('Shipment updated');
  };

  const deleteShipment = (id: string) => {
    if (!confirm('Delete this shipment leg?')) return;
    persist(shipments.filter(s => s.id !== id));
    toast.info('Shipment deleted');
  };

  const changeStatus = (id: string, status: ShipmentStatus) => {
    persist(shipments.map(s => s.id === id ? { ...s, status } : s));
  };

  const visible = filterStatus === 'all' ? shipments : shipments.filter(s => s.status === filterStatus);

  const counts = {
    planned:    shipments.filter(s => s.status === 'planned').length,
    'in-transit': shipments.filter(s => s.status === 'in-transit').length,
    delivered:  shipments.filter(s => s.status === 'delivered').length,
    cancelled:  shipments.filter(s => s.status === 'cancelled').length,
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-black/5 dark:border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic flex items-center gap-2">
              <Anchor className="w-5 h-5 text-amber-500" /> Logistics Hub
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
              Shipment legs — origin, destination, incoterms, status
            </p>
          </div>
          <Button
            onClick={() => { setShowForm(true); setEditId(null); }}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-black uppercase tracking-widest h-9 px-4"
          >
            <Plus className="w-4 h-4 mr-1.5" /> New Shipment
          </Button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3">
          {(['planned', 'in-transit', 'delivered', 'cancelled'] as ShipmentStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
              className={`p-3 rounded-xl border text-left transition-all ${
                filterStatus === s
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-xs ${STATUS_CONFIG[s].color.split(' ')[1]}`}>
                  {STATUS_CONFIG[s].icon}
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {STATUS_CONFIG[s].label}
                </span>
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white">{counts[s]}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {/* New shipment form */}
        {showForm && !editId && (
          <ShipmentForm
            licenses={licenses}
            onSave={addShipment}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* Legal disclaimer */}
        <div className="flex items-start gap-2 bg-slate-100 dark:bg-slate-900 border border-black/5 dark:border-white/5 rounded-xl p-3">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <strong>Disclaimer:</strong> Incoterms, shipment tracking, and fee calculations shown here are workflow planning aids only — not legal, financial, or logistics advice. Engage licensed freight forwarders, customs brokers, and legal counsel for all actual shipments.
          </p>
        </div>

        {/* Shipment list */}
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-700">
            <Truck className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-bold">No shipment legs yet</p>
            <p className="text-xs mt-1 opacity-60">Click "New Shipment" to log a shipment leg</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(leg => (
              <div key={leg.id}>
                {editId === leg.id ? (
                  <ShipmentForm
                    initial={leg}
                    licenses={licenses}
                    onSave={data => updateShipment(leg.id, data)}
                    onCancel={() => setEditId(null)}
                  />
                ) : (
                  <Card className="border-black/5 dark:border-white/5 hover:border-amber-500/20 transition-colors group">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Route */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            {leg.dealLabel && (
                              <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                                {leg.dealLabel}
                              </span>
                            )}
                            <Badge
                              className={`text-[9px] font-black border ${STATUS_CONFIG[leg.status].color} flex items-center gap-1`}
                            >
                              {STATUS_CONFIG[leg.status].icon}
                              {STATUS_CONFIG[leg.status].label}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] font-black text-slate-500 border-slate-300 dark:border-slate-700">
                              {leg.incoterm}
                            </Badge>
                            {leg.eta && (
                              <span className="text-[9px] text-slate-400 font-medium">ETA: {leg.eta}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="truncate">{leg.origin}</span>
                            <ArrowRight className="w-4 h-4 text-amber-500 shrink-0" />
                            <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                            <span className="truncate">{leg.destination}</span>
                          </div>

                          {leg.notes && (
                            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{leg.notes}</p>
                          )}

                          {/* Quick status change */}
                          <div className="flex items-center gap-1.5 mt-3">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Move to:</span>
                            {(['planned', 'in-transit', 'delivered', 'cancelled'] as ShipmentStatus[])
                              .filter(s => s !== leg.status)
                              .map(s => (
                                <button
                                  key={s}
                                  onClick={() => changeStatus(leg.id, s)}
                                  className="text-[9px] font-bold px-2 py-0.5 rounded border border-black/10 dark:border-white/10 text-slate-500 hover:border-amber-400 hover:text-amber-500 transition-colors"
                                >
                                  {STATUS_CONFIG[s].label}
                                </button>
                              ))}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditId(leg.id)}
                            className="p-2 text-slate-400 hover:text-amber-500 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteShipment(leg.id)}
                            className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
