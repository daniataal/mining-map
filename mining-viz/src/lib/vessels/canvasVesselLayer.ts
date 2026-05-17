import L from 'leaflet';
import type { MaritimeVessel } from './types';
import { getVesselChevronDim, type VesselDrawRecord } from './vesselMarkerStyle';

export interface CanvasVesselLayerOptions extends L.LayerOptions {
  mapZoom: number;
  selectedId: string | null;
  onVesselClick?: (vessel: MaritimeVessel) => void;
  formatTooltip?: (vessel: MaritimeVessel) => HTMLElement | string;
}

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

/** Single canvas redraw for all AIS vessels in view — avoids 10k Leaflet DOM markers. */
export class CanvasVesselLayer extends L.Layer {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _records: VesselDrawRecord[] = [];
  private _vesselById = new Map<string, MaritimeVessel>();
  private _mapZoom = 5;
  private _selectedId: string | null = null;
  private _onVesselClick?: (vessel: MaritimeVessel) => void;
  private _formatTooltip?: (vessel: MaritimeVessel) => HTMLElement | string;
  private _raf = 0;
  private _pixelXY: Float32Array = new Float32Array(0);
  private _hoverTooltip: L.Tooltip | null = null;
  private _hoveredId: string | null = null;

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
    this._scheduleRedraw();
  }

  setMapZoom(zoom: number): void {
    if (this._mapZoom === zoom) return;
    this._mapZoom = zoom;
    this._scheduleRedraw();
  }

  setSelectedId(id: string | null): void {
    if (this._selectedId === id) return;
    this._selectedId = id;
    for (const record of this._records) {
      record.isSelected = record.id === id;
    }
    this._scheduleRedraw();
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
    map.on('zoom', this._scheduleRedraw, this);
    map.on('resize', this._scheduleRedraw, this);
    map.on('viewreset', this._scheduleRedraw, this);
    this._canvas.addEventListener('click', this._onCanvasClick);
    this._canvas.addEventListener('mousemove', this._onCanvasMove);
    this._canvas.addEventListener('mouseout', this._onCanvasOut);

    this._scheduleRedraw();
    return this;
  }

  onRemove(): void {
    const map = this._map;
    if (map) {
      map.off('move', this._scheduleRedraw, this);
      map.off('zoom', this._scheduleRedraw, this);
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

  private _redraw(): void {
    const map = this._map;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;

    const size = map.getSize();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const w = size.x;
    const h = size.y;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const topLeft = map.containerPointToLayerPoint(L.point(0, 0));
    L.DomUtil.setPosition(canvas, topLeft);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const records = this._records;
    const n = records.length;
    if (n === 0) {
      this._pixelXY = new Float32Array(0);
      return;
    }

    const pixels = new Float32Array(n * 2);
    const normal: VesselDrawRecord[] = [];
    let selected: VesselDrawRecord | null = null;

    for (let i = 0; i < n; i += 1) {
      const record = records[i];
      const pt = map.latLngToContainerPoint([record.lat, record.lng]);
      pixels[i * 2] = pt.x;
      pixels[i * 2 + 1] = pt.y;
      if (record.isSelected) {
        selected = record;
      } else {
        normal.push(record);
      }
    }

    const drawRecord = (record: VesselDrawRecord, index: number) => {
      const x = pixels[index * 2];
      const y = pixels[index * 2 + 1];
      const dim = getVesselChevronDim(this._mapZoom, record.isSelected);
      drawChevron(ctx, x, y, dim, record.heading, record.color, record.isSelected);
    };

    for (let i = 0; i < n; i += 1) {
      const record = records[i];
      if (!record.isSelected) drawRecord(record, i);
    }
    if (selected) {
      const selIndex = records.indexOf(selected);
      if (selIndex >= 0) drawRecord(selected, selIndex);
    }

    this._pixelXY = pixels;
  }

  private _hitRadius(record: VesselDrawRecord): number {
    return getVesselChevronDim(this._mapZoom, record.isSelected) * 0.65 + 4;
  }

  private _findAtPoint(containerX: number, containerY: number): VesselDrawRecord | null {
    const records = this._records;
    const pixels = this._pixelXY;
    let best: VesselDrawRecord | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < records.length; i += 1) {
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
