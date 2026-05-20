import type { ChecklistItem } from '../types';

export const DEFAULT_CHECKLIST_TEMPLATE: Omit<ChecklistItem, 'checked'>[] = [
  { id: 'dd-license', label: 'Due Diligence — verify license validity with mining authority' },
  { id: 'dd-site', label: 'Due Diligence — confirm site visit / physical inspection' },
  { id: 'kyc-seller', label: 'KYC — identity & beneficial ownership of seller/company' },
  { id: 'kyc-docs', label: 'KYC — collect ID, TIN, registration docs' },
  {
    id: 'sanctions',
    label: 'Sanctions screen — OFAC / EU / UN lists [PLACEHOLDER — consult compliance counsel]',
  },
  { id: 'aml', label: 'AML check — source-of-funds declaration signed' },
  { id: 'contract', label: 'Contract milestone — draft SPA or LOI issued and signed' },
  { id: 'payment', label: 'Payment terms confirmed — escrow / LC / wire details locked' },
  { id: 'assay', label: 'Assay / quality certificate obtained from accredited lab' },
  { id: 'insurance', label: 'Cargo & credit insurance arranged' },
  { id: 'logistics', label: 'Logistics confirmed — shipment legs, incoterm, ETA' },
  { id: 'export-permit', label: 'Export permit / mineral certificate issued by authority' },
];

export function defaultChecklistItems(): ChecklistItem[] {
  return DEFAULT_CHECKLIST_TEMPLATE.map((t) => ({ ...t, checked: false }));
}

export function loadChecklistFromLocalStorage(dealId: string): ChecklistItem[] {
  try {
    const raw = localStorage.getItem(`mining_checklist_${dealId}`);
    if (raw) return JSON.parse(raw) as ChecklistItem[];
  } catch {
    /* ignore */
  }
  return defaultChecklistItems();
}

export function saveChecklistToLocalStorage(dealId: string, items: ChecklistItem[]) {
  localStorage.setItem(`mining_checklist_${dealId}`, JSON.stringify(items));
}

export function resolveChecklistItems(
  dealId: string,
  fromAnnotation?: ChecklistItem[] | null,
): ChecklistItem[] {
  if (fromAnnotation && fromAnnotation.length > 0) return fromAnnotation;
  return loadChecklistFromLocalStorage(dealId);
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number; pct: number } {
  const total = items.length;
  const done = items.filter((it) => it.checked).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}
