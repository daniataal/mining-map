import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

type Props = {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
};

export default function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className = '',
  badge,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">{title}</span>
        <span className="flex items-center gap-1 shrink-0">
          {badge}
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}
