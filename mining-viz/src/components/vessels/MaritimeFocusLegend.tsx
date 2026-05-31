import { useMemo } from 'react';
import type { MaritimeVessel } from '../../lib/vessels/types';
import { buildAisProjectedRoute } from '../../lib/vessels/aisProjectedRoute';
import { useVesselTrack } from '../../hooks/useVesselTrack';
import { useI18n } from '../../lib/i18n';

type MaritimeFocusLegendProps = {
  vessel: MaritimeVessel;
};

export default function MaritimeFocusLegend({ vessel }: MaritimeFocusLegendProps) {
  const { t } = useI18n();
  const { summary, isLoading: trackLoading } = useVesselTrack(vessel.mmsi, 24, true);
  const projected = useMemo(() => buildAisProjectedRoute(vessel), [vessel]);

  const trackRange =
    summary.fromLabel && summary.toLabel
      ? `${summary.fromLabel} → ${summary.toLabel}`
      : summary.pointCount > 0
        ? t('טווח זמן לא זמין', 'Time range unavailable')
        : trackLoading
          ? t('טוען…', 'Loading…')
          : t('אין נקודות מסלול', 'No track points');

  const projectedNote = (() => {
    if (projected.status === 'ready') {
      return t(
        `יעד AIS: ${projected.endpoint.label} (קו מעגל גדול — לא מסלול מוסמך)`,
        `AIS destination: ${projected.endpoint.label} (great-circle — not a certified route)`,
      );
    }
    if (projected.status === 'destination_no_coords') {
      return t(
        `יעד AIS דווח (${projected.destination}) — אין קואורדינטות נמל תואמות`,
        `AIS destination reported (${projected.destination}) — no matching port coordinates`,
      );
    }
    return t('לא דווח יעד AIS', 'No AIS destination reported');
  })();

  return (
    <div className="maritime-focus-legend pointer-events-none" role="status" aria-live="polite">
      <p className="maritime-focus-legend__title">{t('מצב מיקוד', 'Focus mode')}</p>
      <ul className="maritime-focus-legend__list">
        <li>
          <span className="maritime-focus-legend__swatch maritime-focus-legend__swatch--track" aria-hidden />
          <span>
            {t('מסלול AIS (24ש׳)', 'AIS track (24h)')}:{' '}
            {trackLoading ? '…' : summary.pointCount.toLocaleString()} {t('נקודות', 'pts')} · {trackRange}
          </span>
        </li>
        <li>
          <span className="maritime-focus-legend__swatch maritime-focus-legend__swatch--projected" aria-hidden />
          <span>{projectedNote}</span>
        </li>
      </ul>
      <p className="maritime-focus-legend__hint">
        {t(
          'קו סגול = כיוון מחושב מיעד AIS; לא מסלול ניווט מאושר.',
          'Purple line = indicative bearing from AIS destination; not an approved navigation route.',
        )}
      </p>
    </div>
  );
}
