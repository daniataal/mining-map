import { useState } from 'react';
import { LucideChevronDown, LucidePlus, LucideTrash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { BrokerWorkspace } from '../../api/brokerWorkspaceApi';

type Props = {
  workspaces: BrokerWorkspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
};

export function WorkspaceSwitcher({ workspaces, activeId, onSelect, onCreate, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const active = workspaces.find((w) => w.id === activeId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 text-sm font-bold"
      >
        <span className="truncate">{active?.name ?? 'Select workspace'}</span>
        <LucideChevronDown className="w-4 h-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl p-2 space-y-1">
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onSelect(ws.id);
                  setOpen(false);
                }}
                className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm ${
                  ws.id === activeId ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {ws.name}
                {ws.is_default && (
                  <span className="ml-1 text-[9px] uppercase opacity-60">default</span>
                )}
              </button>
              {!ws.is_default && (
                <button
                  type="button"
                  onClick={() => onDelete(ws.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500"
                  title="Delete workspace"
                >
                  <LucideTrash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-1 pt-1 border-t border-black/5 dark:border-white/5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New workspace"
              className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newName.trim()}
              onClick={() => {
                onCreate(newName.trim());
                setNewName('');
                setOpen(false);
              }}
            >
              <LucidePlus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
