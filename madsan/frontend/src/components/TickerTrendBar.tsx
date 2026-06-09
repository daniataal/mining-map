type Props = { changePct: number };

/** Mini sparkline-style trend bars when daily change is available (WTI/Brent). */
export default function TickerTrendBar({ changePct }: Props) {
  const up = changePct > 0;
  const flat = changePct === 0;
  const color = flat ? "var(--muted)" : up ? "var(--verified)" : "var(--danger)";
  const heights = up
    ? [0.35, 0.45, 0.55, 0.72, 0.95]
    : flat
      ? [0.55, 0.55, 0.55, 0.55, 0.55]
      : [0.95, 0.72, 0.55, 0.45, 0.35];

  return (
    <svg
      className="ticker-trend"
      width="28"
      height="12"
      viewBox="0 0 28 12"
      aria-hidden
      title={`${changePct > 0 ? "+" : ""}${changePct}%`}
    >
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 5.5 + 1}
          y={12 - h * 10}
          width="3.5"
          height={h * 10}
          rx="0.5"
          fill={color}
          opacity={0.45 + i * 0.11}
        />
      ))}
    </svg>
  );
}
