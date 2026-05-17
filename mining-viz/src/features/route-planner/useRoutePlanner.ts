import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { RoutePlanOption, RoutePlannerApiResponse } from './types';
import { fetchRoutePlan } from './fetchRoutePlan';

export type RoutePickRole = 'supplier' | 'buyer';
export interface RoutePartyLocation {
  lat: number;
  lng: number;
  label: string;
  country?: string;
  licenseId?: string;
  commodity?: string;
  sector?: string;
}

export const SHIPPING_METHOD_IDS = ['sea_fcl', 'sea_lcl', 'rail', 'truck_inland', 'air'] as const;
export type ShippingMethodId = (typeof SHIPPING_METHOD_IDS)[number];

export const SHIPPING_OPTIONS: {
  id: ShippingMethodId;
  labelHe: string;
  labelEn: string;
  icon: string;
  descEn: string;
}[] = [
  { id: 'sea_fcl', labelHe: 'ימי — FCL (מכולה מלאה)', labelEn: 'Sea — FCL', icon: '🚢', descEn: 'Full container load, cheapest per tonne for large volumes' },
  { id: 'sea_lcl', labelHe: 'ימי — LCL (קונסולידציה)', labelEn: 'Sea — LCL', icon: '⚓', descEn: 'Less-than-container, shared container for smaller shipments' },
  { id: 'rail', labelHe: 'ברזל', labelEn: 'Rail', icon: '🚂', descEn: 'Rail corridor where available — bulk, low-cost inland' },
  { id: 'truck_inland', labelHe: 'משאית / כביש', labelEn: 'Road freight', icon: '🚛', descEn: 'Flexible last-mile or full inland movement' },
  { id: 'air', labelHe: 'מטען אווירי', labelEn: 'Air freight', icon: '✈️', descEn: 'High-value, low-volume cargo only (gold doré, samples)' },
];

export const PRODUCT_OPTIONS: { value: string; labelHe: string; labelEn: string; icon: string }[] = [
  { value: 'gold_concentrate', labelHe: 'ריכוז זהב', labelEn: 'Gold concentrate', icon: '🥇' },
  { value: 'gold_dore', labelHe: 'דוריי / מטילי זהב', labelEn: 'Gold doré / bullion', icon: '🟡' },
  { value: 'cobalt', labelHe: 'קובלט', labelEn: 'Cobalt', icon: '🔋' },
  { value: 'lithium', labelHe: 'ליתיום', labelEn: 'Lithium', icon: '⚡' },
  { value: 'bauxite', labelHe: 'בוקסיט', labelEn: 'Bauxite', icon: '🪨' },
  { value: 'manganese', labelHe: 'מנגן', labelEn: 'Manganese', icon: '⛏️' },
  { value: 'copper', labelHe: 'נחושת', labelEn: 'Copper', icon: '🔴' },
  { value: 'iron_ore', labelHe: 'עפרת ברזל', labelEn: 'Iron ore', icon: '🧲' },
  { value: 'silver', labelHe: 'כסף', labelEn: 'Silver', icon: '🥈' },
  { value: 'petroleum_products', labelHe: 'מוצרי נפט', labelEn: 'Petroleum products', icon: '🛢️' },
  { value: 'aggregates', labelHe: 'אגרגטים', labelEn: 'Aggregates', icon: '🪵' },
];

export interface RouteMapOverlay {
  legs: { path: [number, number][]; method?: string; label?: string }[];
  waypoints: Array<{
    lat: number;
    lng: number;
    role: 'origin' | 'transit' | 'destination';
    label: [string, string];
  }>;
}

export interface RoutePlannerHook {
  supplier: RoutePartyLocation;
  setSupplier: Dispatch<SetStateAction<RoutePartyLocation>>;
  buyer: RoutePartyLocation;
  setBuyer: Dispatch<SetStateAction<RoutePartyLocation>>;
  productType: string;
  setProductType: (value: string) => void;
  quantityTons: number;
  setQuantityTons: (value: number) => void;
  incoterm: string;
  setIncoterm: (value: string) => void;
  shippingMethods: string[];
  toggleShippingMethod: (id: string, checked: boolean) => void;
  pickRole: RoutePickRole | null;
  beginPick: (role: RoutePickRole) => void;
  cancelPick: () => void;
  handleMapPick: (lat: number, lng: number, role: RoutePickRole) => void;
  overlay: RouteMapOverlay | null;
  result: RoutePlannerApiResponse | null;
  /** All route options: recommended first, then alternatives. */
  routeOptions: RoutePlanOption[];
  selectedPlanId: string | null;
  activePlan: RoutePlanOption | null;
  selectRoutePlan: (planId: string) => void;
  loading: boolean;
  error: string | null;
  computeRoute: () => Promise<void>;
  sourceLabel: 'live' | 'simulation' | null;
  /** Pre-fill supplier from a license/asset — call before switching to route_planner view */
  prefillSupplier: (lat: number, lng: number, label: string, meta?: Partial<RoutePartyLocation>) => void;
  hasResult: boolean;
}

export function useRoutePlanner(): RoutePlannerHook {
  const [supplier, setSupplier] = useState<RoutePartyLocation>({ lat: 5.548, lng: -0.192, label: '' });
  const [buyer, setBuyer] = useState<RoutePartyLocation>({ lat: 51.924, lng: 4.478, label: '' });
  const [productType, setProductType] = useState('gold_concentrate');
  const [quantityTons, setQuantityTonsState] = useState(1000);
  const [incoterm, setIncoterm] = useState('FOB');
  const [shippingMethods, setShippingMethods] = useState<string[]>(() => ['sea_fcl', 'truck_inland']);
  const [pickRole, setPickRole] = useState<RoutePickRole | null>(null);
  const [result, setResult] = useState<RoutePlannerApiResponse | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setQuantityTons = useCallback((value: number) => {
    setQuantityTonsState(Number.isFinite(value) ? Math.max(0, value) : 0);
  }, []);

  const prefillSupplier = useCallback((lat: number, lng: number, label: string, meta?: Partial<RoutePartyLocation>) => {
    setSupplier({ lat, lng, label, ...meta });
    // Reset previous result so the user knows they need to compute with the new supplier
    setResult(null);
    setSelectedPlanId(null);
    setError(null);
  }, []);

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
    if (role === 'supplier') setSupplier((s) => ({ ...s, ...snap, licenseId: undefined }));
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
        quantityTons,
        incoterm,
      });
      setResult(res);
      setSelectedPlanId(res.recommendedPlanId ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e ?? 'route error'));
    } finally {
      setLoading(false);
    }
  }, [supplier, buyer, productType, shippingMethods, quantityTons, incoterm]);

  const routeOptions = useMemo((): RoutePlanOption[] => {
    if (!result) return [];
    const recommended: RoutePlanOption = {
      id: result.recommendedPlanId ?? 'recommended',
      label: 'Recommended',
      labelHe: 'מומלץ',
      labelEn: 'Recommended',
      isRecommended: true,
      map: result.map,
      breakdown: result.breakdown,
      totalCostUsd: result.breakdown.reduce((s, r) => s + r.amountUsd, 0),
    };
    const alts = result.routeAlternatives ?? [];
    return [recommended, ...alts.filter((a) => a.id !== recommended.id)];
  }, [result]);

  const activePlan = useMemo(() => {
    if (!routeOptions.length) return null;
    if (selectedPlanId) {
      const match = routeOptions.find((p) => p.id === selectedPlanId);
      if (match) return match;
    }
    return routeOptions[0];
  }, [routeOptions, selectedPlanId]);

  const selectRoutePlan = useCallback((planId: string) => {
    setSelectedPlanId(planId);
  }, []);

  const overlay = activePlan?.map ?? null;
  const sourceLabel = result ? result.source : null;

  return {
    supplier,
    setSupplier,
    buyer,
    setBuyer,
    productType,
    setProductType,
    quantityTons,
    setQuantityTons,
    incoterm,
    setIncoterm,
    shippingMethods,
    toggleShippingMethod,
    pickRole,
    beginPick,
    cancelPick,
    handleMapPick,
    overlay,
    result,
    routeOptions,
    selectedPlanId: activePlan?.id ?? null,
    activePlan,
    selectRoutePlan,
    loading,
    error,
    computeRoute,
    sourceLabel,
    prefillSupplier,
    hasResult: result !== null,
  };
}
