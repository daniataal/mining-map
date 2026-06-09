import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LucideBuilding,
  LucideFileText,
  LucideMapPin,
  LucidePlus,
  LucideSearch,
  LucideShip,
  LucideX,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../../hooks/use-debounced-value';
import { oilLiveApiUrl } from '../../api/oilLiveApi';
import {
  searchWorkspaceLicenses,
  type WorkspaceEntity,
  type WorkspaceSearchHit,
  type WorkspaceSearchResponse,
} from '../../api/brokerWorkspaceApi';
import { toast } from 'sonner';

type WorkspaceEntityType = 'supplier' | 'buyer' | 'facility' | 'route_stop' | 'custom_pin';
type CustomLicenseRole = 'supplier' | 'buyer' | 'facility';

type ImportPayload = {
  hit_type: string;
  ref_id: string;
  display_name: string;
  lat: number;
  lng: number;
  entity_type: WorkspaceEntityType;
};

type Props = {
  onImport: (hit: ImportPayload) => void;
  onAddCustomLicense: (
    body: Partial<WorkspaceEntity> & { entity_type: string; display_name: string },
  ) => void | Promise<void>;
};

const EMPTY_SEARCH: WorkspaceSearchResponse = {
  hits: [],
  total: 0,
  query: '',
};

const EMPTY_CUSTOM_FORM = {
  entityType: 'supplier' as CustomLicenseRole,
  displayName: '',
  country: '',
  commodity: '',
  licenseType: '',
  lat: '',
  lng: '',
  note: '',
};

type CustomFormState = typeof EMPTY_CUSTOM_FORM;
type CustomTextField = Exclude<keyof CustomFormState, 'entityType'>;

function stringFromSource(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function numberFromSource(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hitDisplayName(hit: WorkspaceSearchHit): string {
  const source = hit.source;
  if (hit.type === 'vessel') {
    return stringFromSource(source.vessel_name ?? source.name ?? hit.id) || hit.id;
  }
  return stringFromSource(source.name ?? source.company ?? hit.id) || hit.id;
}

function hitSubtitle(hit: WorkspaceSearchHit): string {
  const source = hit.source;
  const parts =
    hit.type === 'license'
      ? [
          stringFromSource(source.country),
          stringFromSource(source.commodity),
          stringFromSource(source.license_type),
        ]
      : [
          stringFromSource(source.country),
          stringFromSource(source.operator_name),
          stringFromSource(source.type),
        ];
  return parts.filter(Boolean).join(' · ');
}

function hitCoordinates(hit: WorkspaceSearchHit): { lat: number; lng: number } | null {
  const source = hit.source;
  const lat = numberFromSource(source.lat ?? source.latitude);
  const lng = numberFromSource(source.lng ?? source.lon ?? source.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function hitRefId(hit: WorkspaceSearchHit): string {
  const source = hit.source;
  if (hit.type === 'vessel') {
    return stringFromSource(source.imo ?? source.mmsi ?? hit.id) || hit.id;
  }
  return stringFromSource(source.id ?? hit.id) || hit.id;
}

function hitIcon(hit: WorkspaceSearchHit) {
  if (hit.type === 'license') return LucideFileText;
  if (hit.type === 'vessel') return LucideShip;
  return LucideBuilding;
}

function roleLabel(role: WorkspaceEntityType): string {
  if (role === 'custom_pin') return 'Pin';
  if (role === 'facility') return 'Facility';
  if (role === 'route_stop') return 'Route Stop';
  return role === 'supplier' ? 'Supplier' : 'Buyer';
}

function importRolesForHit(hit: WorkspaceSearchHit): WorkspaceEntityType[] {
  if (hit.type === 'license') return ['supplier', 'buyer', 'facility'];
  if (hit.type === 'vessel' || hit.type === 'terminal') return ['facility', 'route_stop'];
  return ['supplier', 'buyer', 'facility', 'route_stop'];
}

export function WorkspaceSearchImport({ onImport, onAddCustomLicense }: Props) {
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState(EMPTY_CUSTOM_FORM);
  const [customSaving, setCustomSaving] = useState(false);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searchEnabled = debouncedQuery.trim().length > 1;

  const licenseQuery = useQuery({
    queryKey: ['workspace-license-search', debouncedQuery],
    queryFn: () => searchWorkspaceLicenses(debouncedQuery, 12),
    enabled: searchEnabled,
    retry: false,
  });

  const platformQuery = useQuery({
    queryKey: ['workspace-platform-search', debouncedQuery],
    queryFn: async (): Promise<WorkspaceSearchResponse> => {
      if (!debouncedQuery.trim()) return EMPTY_SEARCH;
      const res = await fetch(
        oilLiveApiUrl(
          `/api/oil-live/search?q=${encodeURIComponent(debouncedQuery)}&types=company,terminal,vessel&limit=8`,
        ),
      );
      if (!res.ok) return { ...EMPTY_SEARCH, query: debouncedQuery, error: 'search_unavailable' };
      return res.json() as Promise<WorkspaceSearchResponse>;
    },
    enabled: searchEnabled,
    retry: false,
  });

  const licenseHits = useMemo(
    () => (licenseQuery.data?.hits ?? []).filter((hit) => hit.type === 'license'),
    [licenseQuery.data?.hits],
  );
  const platformHits = useMemo(
    () => (platformQuery.data?.hits ?? []).filter((hit) => hit.type !== 'license'),
    [platformQuery.data?.hits],
  );
  const searching = licenseQuery.isLoading || platformQuery.isLoading;

  const handleImport = useCallback(
    (hit: WorkspaceSearchHit, entityType: WorkspaceEntityType) => {
      const coords = hitCoordinates(hit);
      const name = hitDisplayName(hit);
      if (!coords) {
        toast.error('This record has no map coordinates yet');
        return;
      }
      onImport({
        hit_type: hit.type,
        ref_id: hitRefId(hit),
        display_name: name,
        lat: coords.lat,
        lng: coords.lng,
        entity_type: entityType,
      });
      toast.success(`Added ${name} as ${roleLabel(entityType).toLowerCase()}`);
    },
    [onImport],
  );

  const updateCustomField = useCallback(
    (field: CustomTextField, value: string) => {
      setCustomForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAddCustomLicense = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const displayName = customForm.displayName.trim();
      const lat = Number(customForm.lat);
      const lng = Number(customForm.lng);
      if (!displayName) {
        toast.error('Custom license name is required');
        return;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast.error('Latitude and longitude are required for map placement');
        return;
      }
      setCustomSaving(true);
      try {
        await onAddCustomLicense({
          entity_type: customForm.entityType,
          ref_kind: 'custom',
          display_name: displayName,
          lat,
          lng,
          deal_signal: 'maybe',
          dd_stage: 'Needs Review',
          in_dd_queue: true,
          metadata: {
            private_custom_license: true,
            custom_license: true,
            role: customForm.entityType,
            country: customForm.country.trim(),
            commodity: customForm.commodity.trim(),
            license_type: customForm.licenseType.trim(),
            source_note: customForm.note.trim() || 'Broker-entered custom license',
            confidence: 'user_provided',
          },
        });
        toast.success(`Added custom license: ${displayName}`);
        setCustomForm(EMPTY_CUSTOM_FORM);
        setCustomOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not add custom license');
      } finally {
        setCustomSaving(false);
      }
    },
    [customForm, onAddCustomLicense],
  );

  const renderHit = (hit: WorkspaceSearchHit) => {
    const Icon = hitIcon(hit);
    const name = hitDisplayName(hit);
    const subtitle = hitSubtitle(hit);
    const hasCoords = hitCoordinates(hit) != null;
    return (
      <div
        key={`${hit.type}-${hit.id}`}
        className="rounded-xl border border-black/5 bg-white/40 p-2 dark:border-white/5 dark:bg-slate-900/40"
      >
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{name}</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-400">
              {hit.type}
              {subtitle ? ` · ${subtitle}` : ''}
            </p>
            {!hasCoords && (
              <p className="mt-1 text-[10px] font-bold text-red-400">No coordinates</p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-1">
          {importRolesForHit(hit).map((role) => (
            <Button
              key={role}
              size="sm"
              variant="outline"
              disabled={!hasCoords}
              onClick={() => handleImport(hit, role)}
            >
              {(role === 'custom_pin' || role === 'route_stop') && (
                <LucideMapPin className="mr-1 h-3.5 w-3.5" />
              )}
              {roleLabel(role)}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
            Existing Licenses
          </h3>
          <button
            type="button"
            onClick={() => setCustomOpen((open) => !open)}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-500 hover:bg-amber-500/20"
          >
            {customOpen ? <LucideX className="h-3.5 w-3.5" /> : <LucidePlus className="h-3.5 w-3.5" />}
            Custom License
          </button>
        </div>
        <div className="relative">
          <LucideSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search license, supplier, company, vessel, terminal..."
            className="w-full rounded-xl border border-black/10 bg-white/50 py-2 pl-9 pr-3 text-sm dark:border-white/10 dark:bg-slate-900/50"
          />
        </div>
        {searching && <p className="text-xs text-slate-500">Searching...</p>}
        {searchEnabled && licenseQuery.isError && (
          <p className="text-xs font-bold text-red-400">License search is unavailable.</p>
        )}
      </div>

      {customOpen && (
        <form
          onSubmit={handleAddCustomLicense}
          className="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
              License / Company
              <input
                value={customForm.displayName}
                onChange={(e) => updateCustomField('displayName', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Role
              <select
                value={customForm.entityType}
                onChange={(e) =>
                  setCustomForm((prev) => ({
                    ...prev,
                    entityType: e.target.value as CustomLicenseRole,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-2 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              >
                <option value="supplier">Supplier</option>
                <option value="buyer">Buyer</option>
                <option value="facility">Facility / route asset</option>
              </select>
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Country
              <input
                value={customForm.country}
                onChange={(e) => updateCustomField('country', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Commodity
              <input
                value={customForm.commodity}
                onChange={(e) => updateCustomField('commodity', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              License Type
              <input
                value={customForm.licenseType}
                onChange={(e) => updateCustomField('licenseType', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Latitude
              <input
                value={customForm.lat}
                onChange={(e) => updateCustomField('lat', e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Longitude
              <input
                value={customForm.lng}
                onChange={(e) => updateCustomField('lng', e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
            <label className="col-span-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
              Source Note
              <input
                value={customForm.note}
                onChange={(e) => updateCustomField('note', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-sm normal-case tracking-normal dark:border-white/10 dark:bg-slate-950/60"
              />
            </label>
          </div>
          <Button type="submit" className="w-full" disabled={customSaving}>
            <LucidePlus className="mr-2 h-4 w-4" />
            {customSaving ? 'Adding...' : 'Add custom license'}
          </Button>
        </form>
      )}

      {licenseHits.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Platform license records
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">{licenseHits.map(renderHit)}</div>
        </div>
      )}

      {platformHits.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Companies, vessels, terminals
          </p>
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">{platformHits.map(renderHit)}</div>
        </div>
      )}

      {searchEnabled && !searching && licenseHits.length === 0 && platformHits.length === 0 && (
        <p className="rounded-xl border border-dashed border-black/10 px-3 py-4 text-center text-sm text-slate-500 dark:border-white/10">
          No matches yet. Add a custom license or adjust the search.
        </p>
      )}
    </section>
  );
}
