import { create } from 'zustand';

export type DealPackAsset = {
  id: string;
  type: 'license' | 'vessel' | 'custom_pin';
  name: string;
  lat: number;
  lng: number;
};

export type DealPackRoute = {
  id: string;
  sourceId: string;
  targetId: string;
};

interface DealPackState {
  dealName: string;
  setDealName: (name: string) => void;
  
  assets: DealPackAsset[];
  addAsset: (asset: DealPackAsset) => void;
  removeAsset: (id: string) => void;
  
  routes: DealPackRoute[];
  addRoute: (route: DealPackRoute) => void;
  removeRoute: (id: string) => void;
  
  customPinMode: boolean;
  setCustomPinMode: (active: boolean) => void;
  
  clearDealPack: () => void;
}

export const useDealPack = create<DealPackState>((set) => ({
  dealName: 'New Custom Deal Pack',
  setDealName: (name) => set({ dealName: name }),
  
  assets: [],
  addAsset: (asset) => set((state) => {
    if (state.assets.some(a => a.id === asset.id)) return state;
    return { assets: [...state.assets, asset] };
  }),
  removeAsset: (id) => set((state) => ({ 
    assets: state.assets.filter(a => a.id !== id),
    routes: state.routes.filter(r => r.sourceId !== id && r.targetId !== id)
  })),
  
  routes: [],
  addRoute: (route) => set((state) => ({ routes: [...state.routes, route] })),
  removeRoute: (id) => set((state) => ({ routes: state.routes.filter(r => r.id !== id) })),
  
  customPinMode: false,
  setCustomPinMode: (active) => set({ customPinMode: active }),
  
  clearDealPack: () => set({ dealName: 'New Custom Deal Pack', assets: [], routes: [], customPinMode: false })
}));
