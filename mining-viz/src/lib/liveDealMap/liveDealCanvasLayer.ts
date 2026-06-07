import L from 'leaflet';
import { drawLicenseClusterBubble } from '../licenseClusterStyle';
import {
  liveDealFeaturePriority,
  planLiveDealPointFeatureDraw,
} from './liveDealMapLod';
import type {
  LiveDealFeatureKind,
  LiveDealArcFeature,
  LiveDealMapFeature,
  LiveDealPointFeature,
  LiveDealViewport,
} from './liveDealMapTypes';

export interface CanvasLiveDealLayerOptions extends L.LayerOptions {
  mapZoom: number;
  selectedUid: string | null;
  onFeatureClick?: (feature: LiveDealMapFeature) => void;
  clusterPoints?: boolean;
  clusterKinds?: readonly LiveDealFeatureKind[];
  clusterMaxZoom?: number;
  clusterMinCount?: number;
  isDark?: boolean;
}

const MAX_CANVAS_DPR = 2;

function effectiveDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(MAX_CANVAS_DPR, Math.max(1, window.devicePixelRatio || 1));
}

function colorForFeature(feature: LiveDealMapFeature): string {
  if (feature.shape === 'arc' && feature.color) return feature.color;
  if (feature.kind === 'opportunity') return '#10b981';
  if (feature.kind === 'terminal') return '#38bdf8';
  if (feature.kind === 'storage_terminal') return '#06b6d4';
  if (feature.kind === 'storage_tank') return '#94a3b8';
  if (feature.kind === 'tank_farm') return '#f97316';
  if (feature.kind === 'refinery') return '#fb923c';
  if (feature.kind === 'oil_field') return '#1e40af';
  if (feature.kind === 'license') {
    if (feature.styleKey?.startsWith('#')) return feature.styleKey;
    return feature.styleKey === 'gold' ? '#facc15' : '#64748b';
  }
  if (feature.kind === 'server_cluster') {
    const clusterKind = (feature.data as any)?.clusterKind;
    if (clusterKind === 'storage_terminal') return '#06b6d4';
    if (clusterKind === 'tank_farm') return '#f97316';
    if (clusterKind === 'refinery') return '#fb923c';
    if (clusterKind === 'storage_tank') return '#94a3b8';
    return '#2563eb';
  }
  if (feature.kind === 'vessel') return '#f59e0b';
  if (feature.kind === 'trade_flow') return '#a855f7';
  return '#fb923c';
}

function radiusForPoint(feature: LiveDealPointFeature, zoom: number, selected: boolean): number {
  if (feature.kind === 'server_cluster') {
    const count = feature.sourceCount ?? 0;
    const size = count < 10 ? 36 : count < 100 ? 44 : 52;
    return (size / 2) + (selected ? 3 : 0);
  }
  const base =
    feature.kind === 'opportunity'
      ? 8
      : feature.kind === 'server_cluster'
        ? 11
      : feature.kind === 'terminal'
        ? 6.5
        : feature.kind === 'storage_terminal' || feature.kind === 'tank_farm'
          ? 6.5
          : feature.kind === 'storage_tank'
            ? 5
          : feature.kind === 'refinery' || feature.kind === 'oil_field'
            ? 6
        : feature.kind === 'cargo'
          ? 6
          : feature.kind === 'license'
            ? 5.5
            : 5.5;
  const zoomBoost = zoom >= 9 ? 1.5 : zoom >= 7 ? 0.75 : 0;
  return base + zoomBoost + (selected ? 3 : 0);
}

function drawVessel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  heading: number,
  selected: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius * 0.72, radius);
  ctx.lineTo(0, radius * 0.62);
  ctx.lineTo(-radius * 0.72, radius);
  ctx.closePath();
  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.78)';
  ctx.lineWidth = selected ? 2 : 1;
  ctx.shadowColor = selected ? 'rgba(34,211,238,0.55)' : 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = selected ? 12 : 5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPoint(
  ctx: CanvasRenderingContext2D,
  feature: LiveDealPointFeature,
  x: number,
  y: number,
  radius: number,
  selected: boolean,
  hovered: boolean,
  isDark = true,
): void {
  if (feature.kind === 'vessel') {
    drawVessel(ctx, x, y, radius + 1, feature.heading ?? 0, selected);
    return;
  }

  if (feature.kind === 'server_cluster') {
    const count = feature.sourceCount ?? 0;
    const label = count > 999 ? '999+' : count > 1 ? String(count) : '';
    drawLicenseClusterBubble(ctx, x, y, radius, label, isDark, selected, hovered);
    return;
  }

  const color = colorForFeature(feature);
  ctx.save();
  ctx.beginPath();
  if (feature.kind === 'cargo') {
    ctx.setLineDash([3, 3]);
  }
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.8)';
  ctx.lineWidth = selected ? 2.4 : 1.3;
  ctx.shadowColor =
    feature.kind === 'opportunity' ? 'rgba(16,185,129,0.6)' : 'rgba(14,165,233,0.5)';
  ctx.shadowBlur = selected ? 15 : 7;
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  if (feature.kind === 'opportunity') {
    ctx.font = '900 10px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 0.5);
  }

  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34,211,238,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function parseDashArray(value?: string): number[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: L.Point,
  to: L.Point,
  color: string,
  size: number,
  opacity: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.45);
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.45);
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  map: L.Map,
  feature: LiveDealArcFeature,
  selected: boolean,
): void {
  if (feature.positions.length < 2) return;
  const points = feature.positions.map(([lat, lng]) => map.latLngToContainerPoint([lat, lng]));
  const color = colorForFeature(feature);
  const weight = (feature.weight ?? 2.5) + (selected ? 2 : 0);
  const opacity = Math.max(0.2, Math.min(1, feature.opacity ?? 0.72));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length >= 3) {
    ctx.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y);
  } else {
    ctx.lineTo(points[1].x, points[1].y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(parseDashArray(feature.dashArray));
  if (selected) {
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = 10;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, points[Math.max(0, points.length - 2)], points[points.length - 1], color, weight + 7, opacity);
  ctx.restore();
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToArc(map: L.Map, feature: LiveDealArcFeature, x: number, y: number): number {
  const points = feature.positions.map(([lat, lng]) => map.latLngToContainerPoint([lat, lng]));
  if (points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    best = Math.min(
      best,
      pointSegmentDistance(x, y, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y),
    );
  }
  return best;
}

export class CanvasLiveDealLayer extends L.Layer {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _features: LiveDealMapFeature[] = [];
  private _mapZoom = 5;
  private _selectedUid: string | null = null;
  private _externalHoveredUid: string | null = null;
  private _mouseHoveredUid: string | null = null;
  private _onFeatureClick?: (feature: LiveDealMapFeature) => void;
  private _raf = 0;
  private _lastPaintKey = '';
  private _dataEpoch = 0;
  private _lastCssW = 0;
  private _lastCssH = 0;
  private _lastDpr = 0;
  private _drawnFeatures: LiveDealMapFeature[] = [];
  private _lodSubsampling = false;
  private _clusterPoints = false;
  private _clusterKinds: readonly LiveDealFeatureKind[] | undefined;
  private _clusterMaxZoom = 13;
  private _clusterMinCount = 2;
  private _isDark = true;

  constructor(options: CanvasLiveDealLayerOptions) {
    super(options);
    this._mapZoom = options.mapZoom;
    this._selectedUid = options.selectedUid;
    this._onFeatureClick = options.onFeatureClick;
    this._clusterPoints = Boolean(options.clusterPoints);
    this._clusterKinds = options.clusterKinds;
    this._clusterMaxZoom = options.clusterMaxZoom ?? 13;
    this._clusterMinCount = options.clusterMinCount ?? 2;
    this._isDark = options.isDark !== false;
  }

  setFeatures(features: LiveDealMapFeature[]): void {
    this._features = features;
    this._dataEpoch += 1;
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  setMapZoom(zoom: number): void {
    if (this._mapZoom === zoom) return;
    this._mapZoom = zoom;
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  setSelectedUid(uid: string | null): void {
    if (this._selectedUid === uid) return;
    this._selectedUid = uid;
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  setHoveredUid(uid: string | null): void {
    if (this._externalHoveredUid === uid) return;
    this._externalHoveredUid = uid;
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  private _effectiveHoveredUid(): string | null {
    return this._externalHoveredUid ?? this._mouseHoveredUid;
  }

  setOnFeatureClick(handler: ((feature: LiveDealMapFeature) => void) | undefined): void {
    this._onFeatureClick = handler;
  }

  setClusterOptions(options: {
    clusterPoints?: boolean;
    clusterKinds?: readonly LiveDealFeatureKind[];
    clusterMaxZoom?: number;
    clusterMinCount?: number;
    isDark?: boolean;
  }): void {
    const nextClusterPoints = Boolean(options.clusterPoints);
    const nextClusterKinds = options.clusterKinds;
    const nextClusterMaxZoom = options.clusterMaxZoom ?? 13;
    const nextClusterMinCount = options.clusterMinCount ?? 2;
    const nextIsDark = options.isDark !== false;
    if (
      this._clusterPoints === nextClusterPoints &&
      this._clusterKinds === nextClusterKinds &&
      this._clusterMaxZoom === nextClusterMaxZoom &&
      this._clusterMinCount === nextClusterMinCount &&
      this._isDark === nextIsDark
    ) {
      return;
    }
    this._clusterPoints = nextClusterPoints;
    this._clusterKinds = nextClusterKinds;
    this._clusterMaxZoom = nextClusterMaxZoom;
    this._clusterMinCount = nextClusterMinCount;
    this._isDark = nextIsDark;
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  getLastDrawCount(): number {
    return this._drawnFeatures.length;
  }

  getLastLodSubsampling(): boolean {
    return this._lodSubsampling;
  }

  onAdd(map: L.Map): this {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-live-deal-layer') as HTMLCanvasElement;
    this._canvas.style.pointerEvents = 'none';
    this._ctx = this._canvas.getContext('2d', { alpha: true });
    L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
    map.getPane('overlayPane')?.appendChild(this._canvas);

    map.on('move zoom resize viewreset moveend zoomend', this._scheduleRedraw, this);
    map.on('click', this._onMapClick, this);
    map.on('mousemove', this._onMapMouseMove, this);
    map.on('mouseout', this._onMapMouseOut, this);
    this._scheduleRedraw();
    return this;
  }

  onRemove(): void {
    const map = this._map;
    if (map) {
      map.off('move zoom resize viewreset moveend zoomend', this._scheduleRedraw, this);
      map.off('click', this._onMapClick, this);
      map.off('mousemove', this._onMapMouseMove, this);
      map.off('mouseout', this._onMapMouseOut, this);
    }
    this._canvas?.remove();
    this._canvas = null;
    this._ctx = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  private _scheduleRedraw = (): void => {
    if (this._raf || !this._map) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._redraw();
    });
  };

  private _viewport(map: L.Map): LiveDealViewport {
    const b = map.getBounds();
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  }

  private _paintKey(map: L.Map, w: number, h: number, dpr: number, topLeft: L.Point): string {
    const center = map.latLngToContainerPoint(map.getCenter());
    return [
      w,
      h,
      dpr.toFixed(2),
      topLeft.x.toFixed(2),
      topLeft.y.toFixed(2),
      center.x.toFixed(2),
      center.y.toFixed(2),
      map.getZoom().toFixed(3),
      this._mapZoom,
      this._dataEpoch,
      this._selectedUid ?? '',
      this._externalHoveredUid ?? '',
      this._mouseHoveredUid ?? '',
    ].join('|');
  }

  private _redraw(): void {
    const map = this._map;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;

    const hoveredUid = this._effectiveHoveredUid();

    const size = map.getSize();
    const dpr = effectiveDpr();
    const topLeft = map.containerPointToLayerPoint(L.point(0, 0));
    const paintKey = this._paintKey(map, size.x, size.y, dpr, topLeft);
    if (paintKey === this._lastPaintKey) return;

    if (this._lastCssW !== size.x || this._lastCssH !== size.y || this._lastDpr !== dpr) {
      canvas.width = Math.floor(size.x * dpr);
      canvas.height = Math.floor(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      this._lastCssW = size.x;
      this._lastCssH = size.y;
      this._lastDpr = dpr;
    }

    L.DomUtil.setPosition(canvas, topLeft);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const viewport = this._viewport(map);
    const pointPlan = planLiveDealPointFeatureDraw(this._features, viewport, map.getZoom(), this._selectedUid, {
      clusterPoints: this._clusterPoints,
      clusterKinds: this._clusterKinds,
      clusterMaxZoom: this._clusterMaxZoom,
      clusterMinCount: this._clusterMinCount,
    });
    this._lodSubsampling = pointPlan.lodSubsampling;

    const selected: LiveDealMapFeature[] = [];
    const hovered: LiveDealMapFeature[] = [];
    const normal: LiveDealMapFeature[] = [];
    for (const feature of this._features) {
      if (feature.shape === 'arc') {
        if (feature.uid === this._selectedUid) selected.push(feature);
        else if (feature.uid === hoveredUid) hovered.push(feature);
        else normal.push(feature);
      }
    }
    for (const feature of pointPlan.drawFeatures) {
      if (feature.uid === this._selectedUid) selected.push(feature);
      else if (feature.uid === hoveredUid) hovered.push(feature);
      else normal.push(feature);
    }

    const drawn = [...normal, ...hovered, ...selected];
    for (const feature of normal) this._drawFeature(ctx, map, feature, false, false);
    for (const feature of hovered) this._drawFeature(ctx, map, feature, false, true);
    for (const feature of selected) this._drawFeature(ctx, map, feature, true, feature.uid === hoveredUid);
    this._drawnFeatures = drawn;
    this._lastPaintKey = paintKey;
  }

  private _drawFeature(
    ctx: CanvasRenderingContext2D,
    map: L.Map,
    feature: LiveDealMapFeature,
    selected = false,
    hovered = false,
  ): void {
    if (feature.shape === 'arc') {
      drawArc(ctx, map, feature, selected);
      return;
    }
    const point = map.latLngToContainerPoint([feature.lat, feature.lng]);
    drawPoint(
      ctx,
      feature,
      point.x,
      point.y,
      radiusForPoint(feature, map.getZoom(), selected || hovered),
      selected,
      hovered,
      this._isDark
    );
  }

  private _findAtPoint(point: L.Point): LiveDealMapFeature | null {
    const map = this._map;
    if (!map) return null;
    let best: LiveDealMapFeature | null = null;
    let bestDistance = Infinity;

    const drawn = [...this._drawnFeatures].sort((a, b) => {
      const pa = a.shape === 'point' ? liveDealFeaturePriority(a) : 0;
      const pb = b.shape === 'point' ? liveDealFeaturePriority(b) : 0;
      return pb - pa;
    });

    for (const feature of drawn) {
      if (feature.shape === 'point') {
        const p = map.latLngToContainerPoint([feature.lat, feature.lng]);
        const threshold = radiusForPoint(feature, map.getZoom(), feature.uid === this._selectedUid) + 7;
        const distance = Math.hypot(p.x - point.x, p.y - point.y);
        if (distance <= threshold && distance < bestDistance) {
          best = feature;
          bestDistance = distance;
        }
        continue;
      }
      const threshold = Math.max(9, (feature.weight ?? 2.5) + 7);
      const distance = distanceToArc(map, feature, point.x, point.y);
      if (distance <= threshold && distance < bestDistance) {
        best = feature;
        bestDistance = distance;
      }
    }
    return best;
  }

  private _onMapClick = (event: L.LeafletMouseEvent): void => {
    const hit = this._findAtPoint(event.containerPoint);
    if (!hit) return;
    if (event.originalEvent) {
      (event.originalEvent as MouseEvent & { __liveDealCanvasHandled?: boolean }).__liveDealCanvasHandled = true;
      L.DomEvent.stopPropagation(event.originalEvent);
    }
    this._onFeatureClick?.(hit);
  };

  private _onMapMouseMove = (event: L.LeafletMouseEvent): void => {
    const map = this._map;
    if (!map) return;
    const hit = this._findAtPoint(event.containerPoint);
    map.getContainer().style.cursor = hit ? 'pointer' : '';

    const nextHoveredUid = hit ? hit.uid : null;
    if (this._mouseHoveredUid !== nextHoveredUid) {
      this._mouseHoveredUid = nextHoveredUid;
      this._lastPaintKey = '';
      this._scheduleRedraw();
    }
  };

  private _onMapMouseOut = (): void => {
    this._map?.getContainer().style.removeProperty('cursor');
    if (this._mouseHoveredUid !== null) {
      this._mouseHoveredUid = null;
      this._lastPaintKey = '';
      this._scheduleRedraw();
    }
  };
}
