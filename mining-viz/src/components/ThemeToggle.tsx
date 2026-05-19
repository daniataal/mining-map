import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className={`p-3 rounded-2xl border transition-all active:scale-95 shadow-2xl backdrop-blur-2xl
        bg-stone-100/90 dark:bg-slate-950/60
        border-stone-200/90 dark:border-white/10
        text-slate-600 dark:text-slate-400
        hover:text-slate-900 dark:hover:text-white
        ${className ?? ''}`}
    >
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
