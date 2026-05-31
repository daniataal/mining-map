/** Canvas reads the same CSS vars as .custom-cluster-icon--server (App.css :root). */

type ClusterPalette = {
  fill0: string;
  fill1: string;
  fill2: string;
  inset: string;
  border: string;
  glowNear: string;
  text: string;
};

const FALLBACK: Record<'dark' | 'light', ClusterPalette> = {
  dark: {
    fill0: 'rgba(59, 130, 246, 0.38)',
    fill1: 'rgba(59, 130, 246, 0.22)',
    fill2: 'rgba(59, 130, 246, 0.1)',
    inset: 'rgba(59, 130, 246, 0.35)',
    border: 'rgba(96, 165, 250, 0.9)',
    glowNear: 'rgba(59, 130, 246, 0.52)',
    text: '#ffffff',
  },
  light: {
    fill0: 'rgba(37, 99, 235, 0.2)',
    fill1: 'rgba(37, 99, 235, 0.12)',
    fill2: 'rgba(37, 99, 235, 0.06)',
    inset: 'rgba(37, 99, 235, 0.2)',
    border: 'rgba(37, 99, 235, 0.88)',
    glowNear: 'rgba(37, 99, 235, 0.32)',
    text: '#1e3a8a',
  },
};

let paletteCache: Record<'dark' | 'light', ClusterPalette> | null = null;

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadPalette(mode: 'dark' | 'light'): ClusterPalette {
  const fb = FALLBACK[mode];
  const p = `--lc-${mode}`;
  return {
    fill0: readVar(`${p}-fill-0`, fb.fill0),
    fill1: readVar(`${p}-fill-1`, fb.fill1),
    fill2: readVar(`${p}-fill-2`, fb.fill2),
    inset: readVar(`${p}-inset`, fb.inset),
    border: readVar(`${p}-border`, fb.border),
    glowNear: readVar(`${p}-glow-near`, fb.glowNear),
    text: readVar(`${p}-text`, fb.text),
  };
}

/** Same tokens as DOM — loaded from CSS custom properties on :root. */
export function licenseClusterPalette(isDark: boolean): ClusterPalette {
  if (!paletteCache) {
    paletteCache = { dark: loadPalette('dark'), light: loadPalette('light') };
  }
  return paletteCache[isDark ? 'dark' : 'light'];
}

/** Draw canvas clusters using the same colors as DOM markers. */
export function drawLicenseClusterBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  label: string,
  isDark: boolean,
  selected: boolean,
  hovered = false,
): void {
  const p = licenseClusterPalette(isDark);
  ctx.save();

  // Outset soft glow (box-shadow equivalent)
  ctx.shadowColor = p.glowNear;
  ctx.shadowBlur = selected || hovered ? 20 : 8;

  // Solid/flat glassmorphic transparent background (matching DOM bubble background: rgba(59, 130, 246, 0.2))
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = hovered ? p.fill0 : p.fill1; // Increase opacity on hover to match DOM
  ctx.fill();

  // Turn off shadow for crisp borders and text
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Inset glow shadow effect (equivalent to inset 0 0 10px rgba(59, 130, 246, 0.2))
  if (p.inset) {
    ctx.beginPath();
    ctx.arc(x, y, radius - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = p.inset;
    ctx.lineWidth = hovered ? 3.0 : 2.0;
    ctx.globalAlpha = hovered ? 0.25 : 0.12; // super faint, not heavy in the middle!
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // Thin crisp border (matching DOM border: 1px for dark / 2px for light)
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = p.border;
  ctx.lineWidth = isDark ? 1.25 : 2.0;
  ctx.stroke();

  if (label) {
    ctx.font = `900 ${Math.max(10, Math.min(13, radius * 0.38))}px system-ui, sans-serif`;
    ctx.fillStyle = p.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
  }
  ctx.restore();
}

/** Call after theme toggle if CSS vars change (optional). */
export function resetLicenseClusterPaletteCache(): void {
  paletteCache = null;
}
