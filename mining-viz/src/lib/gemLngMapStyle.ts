export function gemLngMarkerStyle(
  terminalType: string,
  status: string,
  isDark: boolean,
): { color: string; fillColor: string; fillOpacity: number; weight: number; radius: number } {
  const type = (terminalType || '').toLowerCase();
  const st = (status || '').toLowerCase();
  const exportHue = isDark ? '#38bdf8' : '#0284c7';
  const importHue = isDark ? '#a78bfa' : '#7c3aed';
  const idle = isDark ? '#64748b' : '#94a3b8';
  let fill = importHue;
  if (type.includes('export')) fill = exportHue;
  if (st.includes('retired') || st.includes('cancel')) fill = idle;
  if (st.includes('propos') || st.includes('construction')) fill = isDark ? '#fbbf24' : '#d97706';
  return {
    color: isDark ? '#0f172a' : '#ffffff',
    fillColor: fill,
    fillOpacity: 0.85,
    weight: 1.5,
    radius: 7,
  };
}
