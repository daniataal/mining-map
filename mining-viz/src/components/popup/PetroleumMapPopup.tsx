import type { ReactNode } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

export type PetroleumMapPopupBadge = {
  label: string;
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
};

export type PetroleumMapPopupAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost';
};

type Props = {
  title: string;
  subtitle?: string | null;
  badges?: PetroleumMapPopupBadge[];
  children?: ReactNode;
  actions?: PetroleumMapPopupAction[];
  coverageFooter?: string | null;
  loading?: boolean;
};

export default function PetroleumMapPopup({
  title,
  subtitle,
  badges = [],
  children,
  actions = [],
  coverageFooter,
  loading = false,
}: Props) {
  return (
    <div className="min-w-[280px] max-w-[340px] space-y-2.5 p-0.5 text-slate-100">
      <div className="space-y-1">
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {badges.map((badge) => (
              <Badge
                key={badge.label}
                variant={badge.variant ?? 'outline'}
                className={`text-[9px] font-black uppercase tracking-widest ${badge.className ?? ''}`}
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
        <h3 className="text-[13px] font-bold leading-snug text-white">{title}</h3>
        {subtitle && (
          <p className="text-[11px] leading-snug text-slate-400">{subtitle}</p>
        )}
      </div>

      {loading ? (
        <div className="space-y-1.5 animate-pulse">
          <div className="h-3 w-4/5 rounded bg-slate-700/80" />
          <div className="h-3 w-3/5 rounded bg-slate-700/60" />
        </div>
      ) : (
        children
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="sm"
              variant={action.variant ?? 'default'}
              className="h-7 text-[11px]"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {coverageFooter && (
        <p className="rounded-md border border-slate-600/40 bg-slate-900/50 px-2 py-1.5 text-[9px] leading-relaxed text-slate-400">
          {coverageFooter}
        </p>
      )}
    </div>
  );
}
