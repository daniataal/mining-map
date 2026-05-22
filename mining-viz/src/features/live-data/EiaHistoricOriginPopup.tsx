import { Archive, ExternalLink } from 'lucide-react';
import { formatUsPortLabel } from '../../lib/usPortCentroids';
import type { EiaHistoricMapOrigin, EiaHistoricOriginImporter } from '../../api/eiaHistoricApi';

function formatBbl(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B bbl`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M bbl`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K bbl`;
  return `${Math.round(val)} bbl`;
}

type Props = {
  label: string;
  origin: EiaHistoricMapOrigin;
  year?: number;
  /** e.g. "Spain → U.S. Gulf Coast" when corridor is highlighted on map */
  routeLabel?: string;
  onSelectImporter?: (importer: EiaHistoricOriginImporter) => void;
};

export default function EiaHistoricOriginPopup({
  label,
  origin,
  year,
  routeLabel,
  onSelectImporter,
}: Props) {
  return (
    <div className="eia-historic-popup-card">
      <div className="eia-historic-popup-header">
        <Archive className="eia-historic-popup-icon" aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 className="eia-historic-popup-title">{label}</h4>
          <p className="eia-historic-popup-sub">
            {formatBbl(origin.volume_bbl)} · {origin.row_count.toLocaleString()} rows
            {year != null ? ` · ${year}` : ''}
          </p>
        </div>
        <span className="eia-historic-popup-tier">Historic · EIA</span>
      </div>
      {routeLabel && (
        <p className="eia-historic-route-pill" title={routeLabel}>
          {routeLabel.includes('→') ? (
            <>
              <span className="eia-historic-route-from">{label}</span>
              <span className="eia-historic-route-arrow" aria-hidden>
                →
              </span>
              <span className="eia-historic-route-to">
                {routeLabel.split('→').slice(1).join('→').trim()}
              </span>
            </>
          ) : (
            <span className="eia-historic-route-to">{routeLabel}</span>
          )}
        </p>
      )}

      {(origin.top_ports?.length ?? 0) > 0 && (
        <div className="eia-historic-popup-section">
          <p className="eia-historic-popup-label">Top U.S. discharge ports</p>
          <ul className="eia-historic-popup-chips">
            {origin.top_ports!.slice(0, 6).map((p) => (
              <li
                key={`${p.port_code ?? ''}-${p.port_city ?? ''}-${p.port_state ?? ''}`}
                className="eia-historic-chip"
              >
                <span>{p.port_label || p.port_city || 'Port'}</span>
                <span className="eia-historic-chip-val">{formatBbl(p.volume_bbl)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {origin.by_commodity.length > 0 && (
        <div className="eia-historic-popup-section">
          <p className="eia-historic-popup-label">Products</p>
          <ul className="eia-historic-popup-chips">
            {origin.by_commodity.slice(0, 6).map((c) => (
              <li key={c.commodity_family} className="eia-historic-chip">
                <span className="capitalize">{c.commodity_family}</span>
                <span className="eia-historic-chip-val">{formatBbl(c.volume_bbl)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {origin.top_importers.length > 0 ? (
        <div className="eia-historic-popup-section">
          <p className="eia-historic-popup-label">Top U.S. importers</p>
          <ul className="eia-historic-importer-list">
            {origin.top_importers.map((imp) => {
              const portHint =
                imp.port_label ||
                formatUsPortLabel(imp.port_city, imp.port_state, imp.port_code);
              return (
                <li key={imp.importer_name}>
                  <button
                    type="button"
                    className="eia-historic-importer-btn"
                    onClick={() => onSelectImporter?.(imp)}
                  >
                    <span className="eia-historic-importer-name">{imp.importer_name}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
                  </button>
                  <span className="eia-historic-importer-meta">
                    {formatBbl(imp.volume_bbl)} · {imp.row_count.toLocaleString()} rows
                    {portHint ? ` · → ${portHint}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="eia-historic-popup-foot">
        Petroleum Supply Monthly files — not live AIS or customs BOL.
      </p>
    </div>
  );
}
