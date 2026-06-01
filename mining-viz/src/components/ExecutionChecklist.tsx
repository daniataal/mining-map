import { useState, useCallback, useEffect } from 'react';
import { ChecklistItem } from '../types';
import { Check, Copy, Download, Plus, X, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  defaultChecklistItems,
  loadChecklistFromLocalStorage,
  saveChecklistToLocalStorage,
} from '../lib/checklistDefaults';

const DISCLAIMER =
  '⚠ This checklist is a workflow aid only — not legal, compliance, or financial advice. ' +
  'Always engage licensed compliance, legal, and financial professionals before executing any transaction.';

interface ExecutionChecklistProps {
  dealId: string;
  dealLabel?: string;
  compact?: boolean;
  /** When provided, checklist syncs to license annotations (server when logged in). */
  items?: ChecklistItem[];
  onItemsChange?: (items: ChecklistItem[]) => void;
}

export default function ExecutionChecklist({
  dealId,
  dealLabel,
  compact = false,
  items: controlledItems,
  onItemsChange,
}: ExecutionChecklistProps) {
  const isControlled = controlledItems != null && onItemsChange != null;

  const [internalItems, setInternalItems] = useState<ChecklistItem[]>(() =>
    isControlled ? controlledItems! : loadChecklistFromLocalStorage(dealId),
  );
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);

  const items = isControlled ? controlledItems! : internalItems;

  useEffect(() => {
    if (!isControlled) {
      setInternalItems(loadChecklistFromLocalStorage(dealId));
    }
  }, [dealId, isControlled]);

  useEffect(() => {
    if (isControlled && controlledItems) {
      setInternalItems(controlledItems);
    }
  }, [isControlled, controlledItems]);

  const persist = useCallback(
    (next: ChecklistItem[]) => {
      if (isControlled) {
        onItemsChange!(next);
      } else {
        setInternalItems(next);
        saveChecklistToLocalStorage(dealId, next);
      }
    },
    [dealId, isControlled, onItemsChange],
  );

  const toggle = (id: string) => {
    persist(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
  };

  const updateNote = (id: string, notes: string) => {
    persist(items.map((it) => (it.id === id ? { ...it, notes } : it)));
  };

  const removeItem = (id: string) => {
    persist(items.filter((it) => it.id !== id));
  };

  const addItem = () => {
    if (!newLabel.trim()) return;
    const next: ChecklistItem = {
      id: `custom-${Date.now()}`,
      label: newLabel.trim(),
      checked: false,
    };
    persist([...items, next]);
    setNewLabel('');
    setShowAddRow(false);
  };

  const toggleNotes = (id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const buildText = () => {
    const header = `EXECUTION CHECKLIST — ${dealLabel || dealId}\nGenerated: ${new Date().toLocaleString()}\n${DISCLAIMER}\n\n`;
    const body = items
      .map(
        (it) => `[${it.checked ? 'X' : ' '}] ${it.label}${it.notes ? `\n    Notes: ${it.notes}` : ''}`,
      )
      .join('\n');
    return header + body;
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      toast.success('Checklist copied to clipboard');
    } catch {
      toast.error('Copy failed — try the download button');
    }
  };

  const downloadTxt = () => {
    const blob = new Blob([buildText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklist-${dealId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Checklist downloaded');
  };

  const { done, total, pct } = (() => {
    const t = items.length;
    const d = items.filter((it) => it.checked).length;
    return { done: d, total: t, pct: t > 0 ? Math.round((d / t) * 100) : 0 };
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">{DISCLAIMER}</p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Progress — {done}/{total} complete
          </span>
          <span className="text-[10px] font-black text-amber-500">{pct}%</span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-500 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        {items.map((item) => {
          const notesOpen = expandedNotes.has(item.id);
          const isSanctions = item.id === 'sanctions' || item.id === 'aml';
          return (
            <div
              key={item.id}
              className={`rounded-lg border transition-colors ${
                item.checked
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : isSanctions
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-black/2 dark:bg-white/2 border-black/5 dark:border-white/5'
              }`}
            >
              <div className="flex items-start gap-2 p-2.5">
                <button
                  onClick={() => toggle(item.id)}
                  className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    item.checked
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-slate-300 dark:border-slate-700 hover:border-amber-400'
                  }`}
                >
                  {item.checked && <Check className="w-3 h-3" />}
                </button>
                <span
                  className={`flex-1 text-xs font-medium leading-snug cursor-pointer select-none ${
                    item.checked
                      ? 'line-through text-slate-400 dark:text-slate-600'
                      : isSanctions
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-700 dark:text-slate-300'
                  }`}
                  onClick={() => toggle(item.id)}
                >
                  {item.label}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleNotes(item.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    title="Add note"
                  >
                    {notesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {!compact && (
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1 text-slate-300 hover:text-red-400 dark:text-slate-700 dark:hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {notesOpen && (
                <div className="px-9 pb-2.5">
                  <input
                    className="w-full text-[11px] bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:border-amber-400 transition-colors"
                    placeholder="Add a note..."
                    value={item.notes || ''}
                    onChange={(e) => updateNote(item.id, e.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!compact && (
        <div>
          {showAddRow ? (
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:border-amber-400 transition-colors"
                placeholder="Custom checklist item..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                autoFocus
              />
              <Button size="sm" onClick={addItem} className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold">
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAddRow(false);
                  setNewLabel('');
                }}
                className="text-slate-400"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddRow(true)}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-amber-500 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add custom item
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-black/5 dark:border-white/5">
        <Badge variant="secondary" className="text-[9px] font-black">
          {done}/{total} done
        </Badge>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={copyToClipboard}
          className="h-8 text-[10px] font-black uppercase tracking-widest border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-amber-400 hover:text-amber-500"
        >
          <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={downloadTxt}
          className="h-8 text-[10px] font-black uppercase tracking-widest border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-amber-400 hover:text-amber-500"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export .txt
        </Button>
      </div>
    </div>
  );
}

export { defaultChecklistItems, loadChecklistFromLocalStorage };
