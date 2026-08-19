import Image from "next/image";
import type { AppearanceMode } from "@/lib/appearance";

type BrandSize = "compact" | "header" | "login" | "marketing";

const BRAND_DIMENSIONS: Record<BrandSize, { width: number; height: number }> = {
  compact: { width: 120, height: 31 },
  header: { width: 152, height: 40 },
  login: { width: 174, height: 45 },
  marketing: { width: 190, height: 49 },
};

function BrandImage({
  appearance,
  size,
  className,
  alt,
  priority,
}: {
  appearance: AppearanceMode;
  size: BrandSize;
  className?: string;
  alt: string;
  priority: boolean;
}) {
  const dimensions = BRAND_DIMENSIONS[size];
  return (
    <Image
      className={className}
      src={`/brand/axora-logo-${appearance}.svg`}
      width={dimensions.width}
      height={dimensions.height}
      alt={alt}
      priority={priority}
      unoptimized
    />
  );
}

export function Brand({
  appearance,
  size = "header",
  compact = false,
  priority = true,
  label = "Axora",
}: {
  appearance?: AppearanceMode;
  size?: BrandSize;
  compact?: boolean;
  priority?: boolean;
  label?: string;
}) {
  const resolvedSize = compact ? "compact" : size;
  if (appearance) {
    return <BrandImage appearance={appearance} size={resolvedSize} alt={label} priority={priority} />;
  }

  return (
    <span className="brand-appearance-pair" role="img" aria-label={label} data-brand-size={resolvedSize}>
      <BrandImage appearance="light" size={resolvedSize} className="brand-appearance-light" alt="" priority={priority} />
      <BrandImage appearance="dark" size={resolvedSize} className="brand-appearance-dark" alt="" priority={priority} />
    </span>
  );
}
