import { BRAND_LOGO_URL, BRAND_NAME_SHORT } from '../lib/brand';

type BrandMarkSize = 'sm' | 'md' | 'lg' | 'rail' | 'header';
type BrandMarkVariant = 'full' | 'emblem';

const sizeClass: Record<BrandMarkSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
  rail: 'h-12 w-12',
  header: 'h-10 w-10',
};

const frameClass =
  'rounded-xl border border-amber-500/45 bg-slate-800/95 p-1 shadow-[0_0_18px_rgba(245,158,11,0.22)] ring-1 ring-amber-400/15';

type BrandMarkProps = {
  size?: BrandMarkSize;
  variant?: BrandMarkVariant;
  framed?: boolean;
  className?: string;
};

export default function BrandMark({
  size = 'md',
  variant = 'full',
  framed = false,
  className = '',
}: BrandMarkProps) {
  const dimension = sizeClass[size];

  if (variant === 'emblem') {
    const emblem = (
      <div className={`${dimension} overflow-hidden rounded-lg`}>
        <img
          src={BRAND_LOGO_URL}
          alt={BRAND_NAME_SHORT}
          className="h-[155%] w-full object-cover object-top"
          draggable={false}
        />
      </div>
    );

    if (framed) {
      return (
        <div className={`${frameClass} ${className}`.trim()} title={BRAND_NAME_SHORT}>
          {emblem}
        </div>
      );
    }

    return (
      <div className={className} title={BRAND_NAME_SHORT}>
        {emblem}
      </div>
    );
  }

  const full = (
    <img
      src={BRAND_LOGO_URL}
      alt={BRAND_NAME_SHORT}
      className={`object-contain ${dimension}`}
      draggable={false}
    />
  );

  if (framed) {
    return (
      <div className={`${frameClass} ${className}`.trim()} title={BRAND_NAME_SHORT}>
        {full}
      </div>
    );
  }

  return (
    <div className={className} title={BRAND_NAME_SHORT}>
      {full}
    </div>
  );
}
