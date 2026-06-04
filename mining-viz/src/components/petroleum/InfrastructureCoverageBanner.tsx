import { useI18n } from '../../lib/i18n';
import {
  formatInfrastructureCoverageBanner,
  infrastructureCoverageGapMessage,
  useInfrastructureCoverage,
} from '../../lib/infrastructureCoverage';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';

interface InfrastructureCoverageBannerProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  storageInView?: number;
}

export default function InfrastructureCoverageBanner({
  bbox,
  enabled,
  storageInView,
}: InfrastructureCoverageBannerProps) {
  const { t } = useI18n();
  const { data, isError } = useInfrastructureCoverage(bbox, enabled);

  if (!enabled || !bbox) return null;

  const gap = infrastructureCoverageGapMessage(data);
  const summary =
    formatInfrastructureCoverageBanner(data, storageInView) ??
    (isError
      ? t('לא ניתן לטעון כיסוי תשתיות', 'Infrastructure coverage unavailable')
      : null);

  if (!summary && !gap) return null;

  return (
    <div
      className="pointer-events-none max-w-[min(520px,calc(100vw-2rem))] rounded-lg border border-slate-500/30 bg-slate-950/90 px-3 py-2 text-center shadow-lg backdrop-blur-sm"
      role="status"
    >
      {gap && (
        <p className="text-[10px] font-medium text-amber-300/95 leading-snug mb-1">{gap}</p>
      )}
      {summary && (
        <p className="text-[10px] text-slate-300 leading-snug">{summary}</p>
      )}
    </div>
  );
}
