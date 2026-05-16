import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { RoutePlannerApiResponse } from './types';
import { fetchRoutePlan } from './fetchRoutePlan';
import { getMockRouteResponse } from './mockRoute';

export type RoutePickRole = 'supplier' | 'buyer';

export const SHIPPING_METHOD_IDS = ['sea_fcl', 'sea_lcl', 'rail', 'truck_inland', 'air'] as const;
export type ShippingMethodId = (typeof SHIPPING_METHOD_IDS)[number];

export const SHIPPING_OPTIONS: {
  id: ShippingMethodId;
  labelHe: string;
  labelEn: string;
}[] = [
  { id: 'sea_fcl', labelHe: 'ימי — מכולה מלאה (FCL)', labelEn: 'Sea — FCL' },
  { id: 'sea_lcl', labelHe: 'ימי — קונסולידציה (LCL)', labelEn: 'Sea — LCL' },
  { id: 'rail', labelHe: 'ברזל', labelEn: 'Rail' },
  { id: 'truck_inland', labelHe: 'מובילת כביש / Feed', labelEn: 'Truck inland / feed' },
  { id: 'air', labelHe: 'מטען אווירי', labelEn: 'Air freight' },
];

export const PRODUCT_OPTIONS: { value: string; labelHe: string; labelEn: string }[] = [
  { value: 'gold_concentrate', labelHe: 'ריכוז זהב', labelEn: 'Gold concentrate' },
  { value: 'cobalt', labelHe: 'קובלט', labelEn: 'Cobalt' },
  { value: 'lithium', labelHe: 'ליתיום', labelEn: 'Lithium' },
  { value: 'bauxite', labelHe: 'בוקסיט', labelEn: 'Bauxite' },
  { value: 'petroleum_products', labelHe: 'מוצרי נפט', labelEn: 'Petroleum products' },
  { value: 'aggregates', labelHe: 'אגרגטים', labelEn: 'Aggregates' },
];

export interface RoutePlannerHook {
  supplier: { lat: number; lng: number; label: string };
  setSupplier: Dispatch<SetStateAction<{ lat: number; lng: number; label: string }>>;
  buyer: { lat: number; lng: number; label: string };
  setBuyer: Dispatch<SetStateAction<{ lat: number; lng: number; label: string }>>;
  productType: string;
  setProductType: (value: string) => void;
  shippingMethods: string[];
  toggleShippingMethod: (id: string, checked: boolean) => void;
  pickRole: RoutePickRole | null;
  beginPick: (role: RoutePickRole) => void;
  cancelPick: () => void;
  handleMapPick: (lat: number, lng: number, role: RoutePickRole) => void;
  overlay: RouteMapOverlay | null;
  result: RoutePlannerApiResponse | null;
  loading: boolean;
  error: string | null;
  computeRoute: () => Promise<void>;
  sourceLabel: 'live' | 'mock' | null;
}

export function useRoutePlanner(): RoutePlannerHook {
  const [supplier, setSupplier] = useState({ lat: 5.548, lng: -0.192, label: '' });
  const [buyer, setBuyer] = useState({ lat: 51.924, lng: 4.478, label: '' });
  const [productType, setProductType] = useState('gold_concentrate');
  const [shippingMethods, setShippingMethods] = useState<string[]>(() => ['sea_fcl', 'truck_inland']);
  const [pickRole, setPickRole] = useState<RoutePickRole | null>(null);
  const [result, setResult] = useState<RoutePlannerApiResponse>(() => getMockRouteResponse());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleShippingMethod = useCallback((id: string, checked: boolean) => {
    setShippingMethods((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }, []);

  const beginPick = useCallback((role: RoutePickRole) => {
    setPickRole((prev) => (prev === role ? null : role));
  }, []);

  const cancelPick = useCallback(() => setPickRole(null), []);

  const handleMapPick = useCallback((lat: number, lng: number, role: RoutePickRole) => {
    const snap = {
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
    };
    if (role === 'supplier') setSupplier((s) => ({ ...s, ...snap }));
    else setBuyer((b) => ({ ...b, ...snap }));
    setPickRole(null);
  }, []);

  const computeRoute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRoutePlan({
        supplier,
        buyer,
        productType,
        shippingMethods,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e ?? 'route error'));
    } finally {
      setLoading(false);
    }
  }, [supplier, buyer, productType, shippingMethods]);

  const overlay = result?.map ?? null;
  const sourceLabel = result ? result.source : null;

  return {
    supplier,
    setSupplier,
    buyer,
    setBuyer,
    productType,
    setProductType,
    shippingMethods,
    toggleShippingMethod,
    pickRole,
    beginPick,
    cancelPick,
    handleMapPick,
    overlay,
    result,
    loading,
    error,
    computeRoute,
    sourceLabel,
  };
}
