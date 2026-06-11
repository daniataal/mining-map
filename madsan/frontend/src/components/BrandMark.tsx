import { BRAND_LOGO_URL, BRAND_NAME_SHORT } from "@/lib/brand";

type BrandMarkSize = "sm" | "md" | "lg" | "header";

type Props = {
  size?: BrandMarkSize;
  /** Crop to emblem (icon portion) for compact rails */
  variant?: "full" | "emblem";
  className?: string;
};

const sizeClass: Record<BrandMarkSize, string> = {
  sm: "brand-mark-sm",
  md: "brand-mark-md",
  lg: "brand-mark-lg",
  header: "brand-mark-header",
};

export default function BrandMark({ size = "md", variant = "full", className = "" }: Props) {
  const cls = `${sizeClass[size]} brand-mark ${className}`.trim();

  if (variant === "emblem") {
    return (
      <span className={`brand-mark-emblem-wrap ${sizeClass[size]} ${className}`.trim()} title={BRAND_NAME_SHORT}>
        <img src={BRAND_LOGO_URL} alt={BRAND_NAME_SHORT} className="brand-mark-emblem" draggable={false} />
      </span>
    );
  }

  return (
    <img src={BRAND_LOGO_URL} alt={BRAND_NAME_SHORT} className={cls} draggable={false} title={BRAND_NAME_SHORT} />
  );
}
