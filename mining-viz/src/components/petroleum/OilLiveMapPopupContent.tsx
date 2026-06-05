import type { CSSProperties } from 'react';
import OilLiveProvenanceBadge from '../../features/live-data/OilLiveProvenanceBadge';
import type { OilLiveDrawerTab } from '../../features/live-data/OilLiveEntityDrawer';
import type {
  MeridianCargoRecord,
  OilLiveVessel,
  OilOpportunity,
  OilTerminal,
  TradeFlowArc,
} from '../../api/oilLiveApi';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import type { OilLiveEntityClickPayload } from './oilLiveEntityPayload';

type SanctionsTone = 'clear' | 'flagged' | 'review' | 'unknown';

function sanctionsTone(value?: string | null): SanctionsTone {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v === 'clear') return 'clear';
  if (v === 'flagged' || v === 'sanctioned' || v === 'match') return 'flagged';
  if (v === 'review' || v === 'pep') return 'review';
  return 'unknown';
}

const SANCTIONS_STYLE: Record<SanctionsTone, { bg: string; color: string; label: string }> = {
  clear: { bg: '#dcfce7', color: '#166534', label: 'Sanctions: clear' },
  flagged: { bg: '#fee2e2', color: '#991b1b', label: 'Sanctions: flagged' },
  review: { bg: '#fef3c7', color: '#92400e', label: 'Sanctions: review' },
  unknown: { bg: '#e2e8f0', color: '#475569', label: 'Sanctions: unknown' },
};

function chipStyle(bg: string, color: string): CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 9,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginRight: 4,
    marginBottom: 2,
  };
}

function LeiChip({ lei }: { lei?: string | null }) {
  if (!lei) return null;
  return (
    <span style={chipStyle('#dbeafe', '#1e3a8a')} title={`LEI ${lei}`}>
      LEI {lei.slice(0, 8)}…
    </span>
  );
}

function SanctionsChip({ status }: { status?: string | null }) {
  const tone = sanctionsTone(status);
  const style = SANCTIONS_STYLE[tone];
  return (
    <span style={chipStyle(style.bg, style.color)} title={style.label}>
      {tone === 'unknown' ? 'unscreened' : tone}
    </span>
  );
}

const RECIPE_TITLES: Record<string, string> = {
  A: 'Sanctions-pivot corridor (commodity x recent port-call switch)',
  B: 'Storage-build inferred lift (terminal level changes)',
  C: 'Tender-driven (USAspending / TED contract win + lift)',
  D: 'Refiner stock draw → import pull',
  E: 'Pipeline outage / disruption substitution',
  F: 'Export-quota window (Comtrade / Census signal)',
  G: 'Refinery-driven (EIA throughput + Comtrade feedstock)',
};

function recipeLabel(recipe?: string | null): { code: string; title: string } | null {
  if (!recipe) return null;
  const match = /[A-G]/i.exec(recipe);
  const code = match ? match[0].toUpperCase() : recipe;
  const title = RECIPE_TITLES[code] ?? recipe;
  return { code, title };
}

function formatVolumeBand(record: MeridianCargoRecord): string | null {
  const unit = record.volume_unit ?? 'bbl';
  const low = record.volume_low;
  const mid = record.volume_best_estimate;
  const high = record.volume_high;
  const parts: string[] = [];
  if (low != null) parts.push(Math.round(low).toLocaleString());
  if (mid != null) parts.push(`≈${Math.round(mid).toLocaleString()}`);
  if (high != null) parts.push(Math.round(high).toLocaleString());
  if (parts.length === 0) return null;
  return `${parts.join(' – ')} ${unit}`;
}

function isPartialCorridor(r: MeridianCargoRecord): boolean {
  const hasLoad = r.corridor_load_lat != null && r.corridor_load_lng != null;
  const hasDisc = r.corridor_discharge_lat != null && r.corridor_discharge_lng != null;
  return hasLoad && !hasDisc;
}

type OilLiveMapPopupContentProps = {
  feature: LiveDealMapFeature;
  onEntityClick?: (payload: OilLiveEntityClickPayload) => void;
};

export default function OilLiveMapPopupContent({ feature, onEntityClick }: OilLiveMapPopupContentProps) {
  const openFeatureDetails = (initialDrawerTab?: OilLiveDrawerTab) => {
    if (!onEntityClick || !feature.payload || typeof feature.payload !== 'object') return;
    onEntityClick({
      ...(feature.payload as OilLiveEntityClickPayload),
      ...(initialDrawerTab ? { initialDrawerTab } : {}),
    });
  };

  if (feature.kind === 'terminal') {
    const term = feature.data as OilTerminal;
    return (
      <div className="oil-live-popup-body">
        <OilLiveProvenanceBadge kind="inferred" className="mb-1" />
        <strong>{term.name}</strong>
        <p>{term.operator_name}</p>
        <p>{(term.products ?? []).slice(0, 4).join(', ')}</p>
        {term.country && <p className="oil-live-popup-muted">{term.country}</p>}
        {onEntityClick && (
          <>
            <button type="button" className="oil-live-popup-btn" onClick={() => openFeatureDetails()}>
              View details
            </button>
            <button
              type="button"
              className="oil-live-popup-btn oil-live-popup-btn--outline"
              onClick={() => openFeatureDetails('workflow')}
            >
              Trading workflow
            </button>
          </>
        )}
      </div>
    );
  }

  if (feature.kind === 'vessel') {
    const vessel = feature.data as OilLiveVessel;
    const sourceType = vessel.source_type?.replace(/_/g, ' ');
    return (
      <div className="oil-live-popup-body">
        <OilLiveProvenanceBadge
          kind={vessel.source ?? vessel.data_source ?? 'live_ais'}
          className="mb-1"
        />
        <strong>{vessel.name ?? vessel.vessel_name ?? `MMSI ${vessel.mmsi}`}</strong>
        <br />
        {vessel.tanker_class}
        {sourceType && (
          <>
            <br />
            <span className="oil-live-popup-muted">{sourceType}</span>
          </>
        )}
        {vessel.freshness_seconds != null && (
          <>
            <br />
            <span className="oil-live-popup-muted">
              Freshness: {Math.round(vessel.freshness_seconds / 60)} min
            </span>
          </>
        )}
        <br />
        <span className="oil-live-popup-muted">AIS does not confirm supplier or receiver.</span>
        {onEntityClick && (
          <button type="button" className="oil-live-popup-btn" onClick={() => openFeatureDetails()}>
            View details
          </button>
        )}
      </div>
    );
  }

  if (feature.kind === 'opportunity') {
    const selected = feature.data as { opportunity?: OilOpportunity };
    const opportunity = selected.opportunity;
    return (
      <div className="oil-live-popup-body">
        <OilLiveProvenanceBadge kind={opportunity?.source_tiers?.[0] ?? 'synthetic'} className="mb-1" />
        <strong>{feature.title}</strong>
        {opportunity?.deal_score != null && (
          <p>Deal score {(opportunity.deal_score * 100).toFixed(0)}%</p>
        )}
        {opportunity?.confidence != null && (
          <p>Confidence {(opportunity.confidence * 100).toFixed(0)}%</p>
        )}
        {opportunity?.hypothesis && <p>{opportunity.hypothesis}</p>}
        {(opportunity?.evidence ?? []).slice(0, 2).map((line, index) => (
          <p key={index} className="oil-live-popup-muted">
            {line}
          </p>
        ))}
        {onEntityClick && (
          <>
            <button type="button" className="oil-live-popup-btn" onClick={() => openFeatureDetails()}>
              View details
            </button>
            <button
              type="button"
              className="oil-live-popup-btn oil-live-popup-btn--outline"
              onClick={() => openFeatureDetails('workflow')}
            >
              Trading workflow
            </button>
          </>
        )}
      </div>
    );
  }

  if (feature.kind === 'trade_flow') {
    const arc = feature.data as TradeFlowArc;
    return (
      <div style={{ minWidth: 220, maxWidth: 280 }}>
        <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <span style={chipStyle('#fef3c7', '#92400e')}>Trade flow</span>
          <span style={chipStyle('#e0f2fe', '#075985')}>
            {arc.group === 'company_pair' ? 'Company pair' : 'Country pair'}
          </span>
          <span style={chipStyle('#ede9fe', '#5b21b6')}>{arc.commodity_family}</span>
        </div>
        <strong>
          {arc.shipper} → {arc.consignee}
        </strong>
        <br />
        <span style={{ fontSize: 11 }}>
          {arc.cargo_count.toLocaleString()} cargo{arc.cargo_count === 1 ? '' : 'es'} ·{' '}
          {Math.round(arc.volume_total).toLocaleString()} {arc.volume_unit || ''}
        </span>
        <br />
        <span style={{ fontSize: 11 }}>
          Confidence avg {(arc.avg_confidence * 100).toFixed(0)}%
        </span>
        {arc.sample_mcr_ids.length > 0 && onEntityClick && (
          <div style={{ marginTop: 6 }}>
            <p
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: '#475569',
                textTransform: 'uppercase',
                margin: '0 0 2px',
              }}
            >
              Contributing cargoes
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {arc.sample_mcr_ids.slice(0, 5).map((mcrId) => (
                <button
                  key={mcrId}
                  type="button"
                  onClick={() =>
                    onEntityClick({
                      entityKind: 'cargo',
                      entityId: mcrId,
                      title: `MCR ${mcrId.slice(0, 8)}`,
                      subtitle: `${arc.shipper} → ${arc.consignee}`,
                    })
                  }
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    background: '#f8fafc',
                    color: '#0f172a',
                    padding: '2px 6px',
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                  }}
                >
                  {mcrId.slice(0, 8)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const record = feature.data as MeridianCargoRecord;
  const volumeBand = formatVolumeBand(record);
  const recipe = recipeLabel(record.recipe);
  const evidenceTop = (record.evidence_chain ?? []).slice(0, 2);
  const sources = record.sources ?? [];

  return (
    <div style={{ minWidth: 220, maxWidth: 280 }}>
      <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <OilLiveProvenanceBadge kind={record.data_provenance ?? 'synthetic'} />
        {record.bol_tier && <span style={chipStyle('#f1f5f9', '#0f172a')}>{record.bol_tier}</span>}
        {recipe && (
          <span style={chipStyle('#ede9fe', '#5b21b6')} title={recipe.title}>
            Recipe {recipe.code}
          </span>
        )}
        {isPartialCorridor(record) && (
          <span style={chipStyle('#fef3c7', '#92400e')}>partial corridor</span>
        )}
      </div>
      <strong>{record.commodity_family ?? 'Cargo corridor'}</strong>
      <br />
      {record.shipper_name && (
        <>
          Shipper: {record.shipper_name}
          <br />
        </>
      )}
      {record.consignee_name && (
        <>
          Consignee: {record.consignee_name}
          <br />
        </>
      )}
      {record.load_port_name && (
        <>
          Load: {record.load_port_name}
          <br />
        </>
      )}
      {(record.discharge_hint || record.discharge_country) && (
        <>
          Discharge: {record.discharge_hint ?? record.discharge_country}
          <br />
        </>
      )}
      {volumeBand && (
        <>
          Volume: {volumeBand}
          {record.volume_method && (
            <span style={{ ...chipStyle('#e0f2fe', '#075985'), marginLeft: 4 }}>
              {record.volume_method}
            </span>
          )}
          <br />
        </>
      )}
      {record.confidence != null && (
        <>
          Confidence: {(record.confidence * 100).toFixed(0)}%
          <br />
        </>
      )}

      {(record.shipper_lei ||
        record.consignee_lei ||
        record.shipper_sanctions_status ||
        record.consignee_sanctions_status) && (
        <div style={{ marginTop: 6 }}>
          {(record.shipper_lei || record.shipper_sanctions_status) && (
            <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>
              <span style={{ fontWeight: 800 }}>Shipper: </span>
              <LeiChip lei={record.shipper_lei} />
              <SanctionsChip status={record.shipper_sanctions_status} />
            </div>
          )}
          {(record.consignee_lei || record.consignee_sanctions_status) && (
            <div style={{ fontSize: 9, color: '#475569' }}>
              <span style={{ fontWeight: 800 }}>Consignee: </span>
              <LeiChip lei={record.consignee_lei} />
              <SanctionsChip status={record.consignee_sanctions_status} />
            </div>
          )}
        </div>
      )}

      {evidenceTop.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <p
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: '#475569',
              textTransform: 'uppercase',
              margin: '0 0 2px',
            }}
          >
            Evidence
          </p>
          <ul style={{ margin: 0, paddingLeft: 14, fontSize: 10, color: '#334155' }}>
            {evidenceTop.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10 }}>
          <span style={{ fontWeight: 800, color: '#475569' }}>Verify source: </span>
          {sources
            .filter((s) => s?.url)
            .slice(0, 3)
            .map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#0369a1', marginRight: 6, textDecoration: 'underline' }}
              >
                {s.name ?? `#${i + 1}`}
              </a>
            ))}
        </div>
      )}
      {onEntityClick && (
        <button type="button" className="oil-live-popup-btn" onClick={() => openFeatureDetails()}>
          View details
        </button>
      )}
    </div>
  );
}
