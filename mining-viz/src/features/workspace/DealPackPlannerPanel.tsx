import { useState } from 'react';
import { LucideBriefcase, LucideMapPin, LucidePlus, LucideRoute, LucideSave, LucideTrash2, LucideCheckCircle2, LucideNetwork } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { toast } from 'sonner';
import { useDealPack } from '../../hooks/use-deal-pack';

export function DealPackPlannerPanel() {
  const { t } = useI18n();
  const { dealName, setDealName, assets, removeAsset, customPinMode, setCustomPinMode, clearDealPack } = useDealPack();

  const handleSave = () => {
    toast.success('Deal Pack Saved!', {
      description: 'Your deal pack configuration has been saved to the database.',
    });
  };

  return (
    <div className="h-full bg-stone-100 dark:bg-slate-900 border-l border-black/10 dark:border-white/10 shadow-2xl flex flex-col pointer-events-auto">
      {/* Header */}
      <div className="shrink-0 border-b border-black/5 dark:border-white/5 bg-white dark:bg-slate-950 p-6 pt-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
            <LucideBriefcase className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <input 
              type="text" 
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight bg-transparent border-none outline-none focus:ring-2 focus:ring-amber-500/50 rounded-lg px-2 w-full"
            />
          </div>
        </div>
        <p className="text-sm text-slate-500 font-medium px-2">Geospatial Sandbox</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* Selected Assets Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Map Assets</h3>
            <span className="text-xs font-bold text-amber-500">{assets.length} Selected</span>
          </div>
          
          {assets.length === 0 ? (
            <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 border-dashed rounded-xl p-6 text-center text-slate-500">
              <LucideNetwork className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Click on any mine, vessel, or terminal on the map to add it to your Deal Pack.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {assets.map(asset => (
                <div key={asset.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-slate-100 truncate">{asset.name}</span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">{asset.type}</span>
                  </div>
                  <button onClick={() => removeAsset(asset.id)} className="p-2 text-slate-500 hover:text-red-400">
                    <LucideTrash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Custom Suppliers / Pins */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Custom Nodes</h3>
          </div>
          
          <Button 
            variant="outline" 
            className={`w-full justify-start ${customPinMode ? 'border-amber-500 text-amber-500' : 'text-slate-600 dark:text-slate-300'}`}
            onClick={() => setCustomPinMode(!customPinMode)}
          >
            <LucideMapPin className="w-4 h-4 mr-2" />
            {customPinMode ? 'Click on Map to Drop Pin' : 'Drop Custom Supplier Pin'}
          </Button>
        </section>

        {/* Routes */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Deal Routes</h3>
          </div>
          
          <Button variant="outline" className="w-full justify-start text-slate-600 dark:text-slate-300">
            <LucideRoute className="w-4 h-4 mr-2 text-amber-500" />
            Draw Logistics Route
          </Button>
        </section>

      </div>

      {/* Footer */}
      <div className="shrink-0 p-6 bg-white dark:bg-slate-950 border-t border-black/5 dark:border-white/5">
        <Button onClick={handleSave} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold h-12">
          <LucideSave className="w-5 h-5 mr-2" />
          Save Deal Pack
        </Button>
      </div>
    </div>
  );
}
