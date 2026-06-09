import { useCallback, useState } from 'react';

export type BunkerRegistryLayout = 'closed' | 'full' | 'split';

export type BunkerRegistryState = {
  layout: BunkerRegistryLayout;
  hubLocode: string | null;
  selectedSupplierId: string | null;
  search: string;
};

export const BUNKER_REGISTRY_LAST_HUB_KEY = 'bunker_registry_last_hub';

export function readLastBunkerHub(): string | null {
  try {
    return localStorage.getItem(BUNKER_REGISTRY_LAST_HUB_KEY);
  } catch {
    return null;
  }
}

export function persistLastBunkerHub(locode: string | null): void {
  try {
    if (locode) {
      localStorage.setItem(BUNKER_REGISTRY_LAST_HUB_KEY, locode);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function useBunkerRegistryState() {
  const [layout, setLayout] = useState<BunkerRegistryLayout>('closed');
  const [hubLocode, setHubLocode] = useState<string | null>(() => readLastBunkerHub());
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const openRegistry = useCallback((opts?: { hub?: string; layout?: BunkerRegistryLayout }) => {
    setLayout(opts?.layout ?? 'split');
    if (opts?.hub) setHubLocode(opts.hub);
    else setHubLocode((prev) => prev ?? readLastBunkerHub());
  }, []);

  const closeRegistry = useCallback(() => {
    setHubLocode((prev) => {
      persistLastBunkerHub(prev);
      return prev;
    });
    setLayout('closed');
    setSelectedSupplierId(null);
  }, []);

  const changeHub = useCallback((locode: string) => {
    setHubLocode(locode);
    persistLastBunkerHub(locode);
  }, []);

  return {
    layout,
    setLayout,
    hubLocode,
    setHubLocode: changeHub,
    selectedSupplierId,
    setSelectedSupplierId,
    search,
    setSearch,
    openRegistry,
    closeRegistry,
    isOpen: layout !== 'closed',
  };
}
