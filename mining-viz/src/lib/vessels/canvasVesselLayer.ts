import L from 'leaflet';
import type { MaritimeVessel } from './types';
import { getVesselChevronDim, type VesselDrawRecord } from './vesselMarkerStyle';
import { planVesselLodDraw } from './vesselDisplayLod';

export interface CanvasVesselLayerOptions extends L.LayerOptions {
  mapZoom: number;
  selectedId: string | null;
  onVesselClick?: (vessel: MaritimeVessel) => void;
  formatTooltip?: (vessel: MaritimeVessel) => HTMLElement | string;
}

/**
 * Vessel canvas performance uses **display LOD** (level-of-detail subsampling), not clustering:
 * at low zoom we cap how many chevrons are painted per frame using a geographic grid so one
 * preferred vessel (tankers first) wins per cell; at high zoom we draw every vessel in the
 * current map bounds. Pan/zoom stays responsive without merging markers into cluster bubbles.
 *
 * OffscreenCanvas is intentionally not used: Leaflet owns an HTMLCanvasElement in the overlay
 * pane; moving rasterization to a worker would duplicate feed sync and complicate hit-testing.
 */

/** Hit-test spatial hash cell size in CSS pixels. */
const HIT_CELL_PX = 44;

/** devicePixelRatio cap — sharp enough on retina without oversized framebuffers. */
const MAX_CANVAS_DPR = 2;

function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dim: number,
  headingDeg: number,
  color: string,
  isSelected: boolean,
): void {
  const half = dim / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -half);
  ctx.lineTo(half, half);
  ctx.lineTo(0, half * 0.82);
  ctx.lineTo(-half, half);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = isSelected ? 1.5 : 1;
  if (isSelected) {
    ctx.shadowColor = 'rgba(34,211,238,0.45)';
    ctx.shadowBlur = 10;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 4;
  }
  ctx.stroke();
  ctx.restore();
}

function effectiveDpr(): number {
  if (typeof window === 'undefined') return 1;
  const raw = window.devicePixelRatio || 1;
  return Math.min(MAX_CANVAS_DPR, Math.max(1, raw));
}

export class CanvasVesselLayer extends L.Layer {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _records: VesselDrawRecord[] = [];
  private _vesselById = new Map<string, MaritimeVessel>();
  private _mapZoom = 5;
  private _selectedId: string | null = null;
  private _selectedIndex = -1;
  private _onVesselClick?: (vessel: MaritimeVessel) => void;
  private _formatTooltip?: (vessel: MaritimeVessel) => HTMLElement | string;
  private _raf = 0;
  private _pixelXY: Float32Array = new Float32Array(0);
  private _hoverTooltip: L.Tooltip | null = null;
  private _hoveredId: string | null = null;

  /** Spatial hash: cellKey -> record indices eligible for hit testing. */
  private _hitBuckets = new Map<number, number[]>();
  private _hitCols = 1;
  private _hitRows = 1;

  private _lastPaintKey = '';
  private _lastCssW = 0;
  private _lastCssH = 0;
  private _lastDpr = 0;
  private _dataEpoch = 0;
  private _lastDrawCount = 0;
  private _lastLodSubsampling = false;

  constructor(options: CanvasVesselLayerOptions = { mapZoom: 5, selectedId: null }) {
    super(options);
    this._mapZoom = options.mapZoom;
    this._selectedId = options.selectedId;
    this._onVesselClick = options.onVesselClick;
    this._formatTooltip = options.formatTooltip;
  }

  setVessels(vessels: MaritimeVessel[], records: VesselDrawRecord[]): void {
    this._records = records;
    this._vesselById = new Map(vessels.map((v) => [v.id, v]));
    this._recomputeSelectedIndex();
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

  setSelectedId(id: string | null): void {
    if (this._selectedId === id) return;
    this._selectedId = id;
    for (const record of this._records) {
      record.isSelected = record.id === id;
    }
    this._recomputeSelectedIndex();
    this._lastPaintKey = '';
    this._scheduleRedraw();
  }

  private _recomputeSelectedIndex(): void {
    const records = this._records;
    let idx = -1;
    for (let i = 0; i < records.length; i += 1) {
      if (records[i].isSelected) {
        idx = i;
        break;
      }
    }
    this._selectedIndex = idx;
  }

  setOnVesselClick(handler: ((vessel: MaritimeVessel) => void) | undefined): void {
    this._onVesselClick = handler;
  }

  setFormatTooltip(formatter: ((vessel: MaritimeVessel) => HTMLElement | string) | undefined): void {
    this._formatTooltip = formatter;
  }

  onAdd(map: L.Map): this {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-vessel-layer') as HTMLCanvasElement;
    const pane = map.getPane('overlayPane');
    if (pane) pane.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d', { alpha: true });
    L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
    this._canvas.style.pointerEvents = 'auto';

    map.on('move', this._scheduleRedraw, this);
    map.on('moveend', this._scheduleRedraw, this);
    map.on('zoom', this._scheduleRedraw, this);
    map.on('zoomend', this._scheduleRedraw, this);
    map.on('resize', this._scheduleRedraw, this);
    map.on('viewreset', this._scheduleRedraw, this);
    this._canvas.addEventListener('click', this._onCanvasClick);
    this._canvas.addEventListener('mousemove', this._onCanvasMove);
    this._canvas.addEventListener('mouseout', this._onCanvasOut);

    this._lastPaintKey = '';
    this._scheduleRedraw();
    return this;
  }

  onRemove(): void {
    const map = this._map;
    if (map) {
      map.off('move', this._scheduleRedraw, this);
      map.off('moveend', this._scheduleRedraw, this);
      map.off('zoom', this._scheduleRedraw, this);
      map.off('zoomend', this._scheduleRedraw, this);
      map.off('resize', this._scheduleRedraw, this);
      map.off('viewreset', this._scheduleRedraw, this);
    }
    if (this._canvas) {
      this._canvas.removeEventListener('click', this._onCanvasClick);
      this._canvas.removeEventListener('mousemove', this._onCanvasMove);
      this._canvas.removeEventListener('mouseout', this._onCanvasOut);
      this._canvas.remove();
    }
    this._canvas = null;
    this._ctx = null;
    this._clearHoverTooltip();
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    return this;
  }

  private _scheduleRedraw = (): void => {
    if (this._raf || !this._map) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._redraw();
    });
  };

  /**
   * Picks record indices to draw this frame: viewport clip, then either all (high zoom / small N)
   * or geographic grid subsampling (display LOD — tankers preferred per cell).
   */
  private _computeDrawIndices(map: L.Map, records: VesselDrawRecord[]): number[] {
    const bounds = map.getBounds();
    if (!bounds.isValid()) {
      this._lastLodSubsampling = false;
      return [];
    }

    const plan = planVesselLodDraw(
      records,
      {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      },
      map.getZoom(),
      (lat, lng) => bounds.contains([lat, lng]),
    );
    this._lastLodSubsampling = plan.lodSubsampling;
    return plan.drawIndices;
  }

  /** Last frame: how many chevrons were rasterized (for parent UI). */
  getLastDrawCount(): number {
    return this._lastDrawCount;
  }

  getLastLodSubsampling(): boolean {
    return this._lastLodSubsampling;
  }

  private _ensureSelectedInDraw(draw: number[], records: VesselDrawRecord[]): number[] {
    const sel = this._selectedIndex;
    if (sel < 0) return draw;
    if (draw.includes(sel)) return draw;
    const next = draw.slice();
    next.push(sel);
    return next;
  }

  private _rebuildHitGrid(cssW: number, cssH: number, draw: number[], pixels: Float32Array): void {
    this._hitBuckets.clear();
    this._hitCols = Math.max(1, Math.ceil(cssW / HIT_CELL_PX));
    this._hitRows = Math.max(1, Math.ceil(cssH / HIT_CELL_PX));

    for (let d = 0; d < draw.length; d += 1) {
      const i = draw[d];
      const x = pixels[i * 2];
      const y = pixels[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      let cx = Math.floor(x / HIT_CELL_PX);
      let cy = Math.floor(y / HIT_CELL_PX);
      cx = Math.max(0, Math.min(this._hitCols - 1, cx));
      cy = Math.max(0, Math.min(this._hitRows - 1, cy));
      const key = cy * this._hitCols + cx;
      let bucket = this._hitBuckets.get(key);
      if (!bucket) {
        bucket = [];
        this._hitBuckets.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  private _paintStateKey(map: L.Map, w: number, h: number, dpr: number, topLeft: L.Point): string {
    const zMap = map.getZoom();
    const center = map.latLngToContainerPoint(map.getCenter());
    return [
      w,
      h,
      dpr.toFixed(2),
      topLeft.x.toFixed(2),
      topLeft.y.toFixed(2),
      center.x.toFixed(2),
      center.y.toFixed(2),
      zMap.toFixed(3),
      this._mapZoom,
      this._dataEpoch,
      this._selectedId ?? '',
    ].join('|');
  }

  private _redraw(): void {
    const map = this._map;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;

    const size = map.getSize();
    const dpr = effectiveDpr();
    const w = size.x;
    const h = size.y;

    const topLeft = map.containerPointToLayerPoint(L.point(0, 0));
    const paintKey = this._paintStateKey(map, w, h, dpr, topLeft);

    const records = this._records;
    const n = records.length;

    if (n === 0) {
      if (paintKey === this._lastPaintKey && this._pixelXY.length === 0) {
        return;
      }
      if (this._lastCssW !== w || this._lastCssH !== h || this._lastDpr !== dpr) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        this._lastCssW = w;
        this._lastCssH = h;
        this._lastDpr = dpr;
      }
      L.DomUtil.setPosition(canvas, topLeft);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this._pixelXY = new Float32Array(0);
      this._hitBuckets.clear();
      this._lastPaintKey = paintKey;
      return;
    }

    let draw = this._computeDrawIndices(map, records);
    draw = this._ensureSelectedInDraw(draw, records);
    this._lastDrawCount = draw.length;

    if (paintKey === this._lastPaintKey && this._pixelXY.length === n * 2) {
      return;
    }

    if (this._lastCssW !== w || this._lastCssH !== h || this._lastDpr !== dpr) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      this._lastCssW = w;
      this._lastCssH = h;
      this._lastDpr = dpr;
    }
    L.DomUtil.setPosition(canvas, topLeft);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pixels = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      const record = records[i];
      const pt = map.latLngToContainerPoint([record.lat, record.lng]);
      pixels[i * 2] = pt.x;
      pixels[i * 2 + 1] = pt.y;
    }
    this._pixelXY = pixels;
    this._rebuildHitGrid(w, h, draw, pixels);

    const drawRecord = (record: VesselDrawRecord, index: number) => {
      const px = pixels[index * 2];
      const py = pixels[index * 2 + 1];
      const dim = getVesselChevronDim(this._mapZoom, record.isSelected);
      drawChevron(ctx, px, py, dim, record.heading, record.color, record.isSelected);
    };

    let selectedInDraw = -1;
    for (let d = 0; d < draw.length; d += 1) {
      if (records[draw[d]].isSelected) {
        selectedInDraw = draw[d];
        break;
      }
    }

    for (let d = 0; d < draw.length; d += 1) {
      const i = draw[d];
      if (i === selectedInDraw) continue;
      drawRecord(records[i], i);
    }
    if (selectedInDraw >= 0) {
      drawRecord(records[selectedInDraw], selectedInDraw);
    }

    this._lastPaintKey = paintKey;
  }

  private _hitRadius(record: VesselDrawRecord): number {
    return getVesselChevronDim(this._mapZoom, record.isSelected) * 0.65 + 4;
  }

  private _findAtPoint(containerX: number, containerY: number): VesselDrawRecord | null {
    const records = this._records;
    const pixels = this._pixelXY;
    if (records.length === 0 || pixels.length !== records.length * 2) return null;

    let cx = Math.floor(containerX / HIT_CELL_PX);
    let cy = Math.floor(containerY / HIT_CELL_PX);
    cx = Math.max(0, Math.min(this._hitCols - 1, cx));
    cy = Math.max(0, Math.min(this._hitRows - 1, cy));

    let best: VesselDrawRecord | null = null;
    let bestDist = Infinity;

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= this._hitCols || ny >= this._hitRows) continue;
        const bucket = this._hitBuckets.get(ny * this._hitCols + nx);
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b += 1) {
          const i = bucket[b];
          const px = pixels[i * 2];
          const py = pixels[i * 2 + 1];
          if (!Number.isFinite(px)) continue;
          const record = records[i];
          const threshold = this._hitRadius(record);
          const dx = px - containerX;
          const dy = py - containerY;
          const dist = Math.hypot(dx, dy);
          if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            best = record;
          }
        }
      }
    }
    return best;
  }

  private _onCanvasClick = (event: MouseEvent): void => {
    const map = this._map;
    if (!map) return;
    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = this._findAtPoint(x, y);
    if (!hit) return;
    L.DomEvent.stopPropagation(event);
    const vessel = this._vesselById.get(hit.id);
    if (vessel) this._onVesselClick?.(vessel);
  };

  private _onCanvasMove = (event: MouseEvent): void => {
    const map = this._map;
    if (!map || !this._formatTooltip) return;
    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = this._findAtPoint(x, y);
    if (!hit) {
      this._clearHoverTooltip();
      return;
    }
    if (hit.id === this._hoveredId) return;
    const vessel = this._vesselById.get(hit.id);
    if (!vessel) return;
    this._hoveredId = hit.id;
    this._clearHoverTooltip();
    const content = this._formatTooltip(vessel);
    this._hoverTooltip = L.tooltip({
      direction: 'top',
      offset: [0, -8],
      opacity: 1,
      className: 'vessel-canvas-tooltip',
      sticky: true,
    })
      .setLatLng([vessel.lat, vessel.lng])
      .setContent(content)
      .addTo(map);
  };

  private _onCanvasOut = (): void => {
    this._clearHoverTooltip();
  };

  private _clearHoverTooltip(): void {
    this._hoveredId = null;
    if (this._hoverTooltip && this._map) {
      this._map.removeLayer(this._hoverTooltip);
    }
    this._hoverTooltip = null;
  }
}
