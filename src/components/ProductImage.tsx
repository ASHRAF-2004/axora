/* eslint-disable @next/next/no-img-element */

import type { Product } from "@/lib/types";
import { Coffee, FileText, Package, Printer, Sparkles, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

type ProductImageProduct = Pick<Product, "category" | "code" | "hasImage" | "id" | "imageAltText" | "name">;

type Artwork = {
  accent: string;
  background: string;
  foreground: string;
  Icon: LucideIcon;
};

function artworkFor(category: string): Artwork {
  const normalized = category.toLowerCase();

  if (normalized.includes("cleaning") || normalized.includes("hygiene")) {
    return {
      accent: "#0f9d8a",
      background: "linear-gradient(145deg, #ecfeff 0%, #ccfbf1 58%, #99f6e4 100%)",
      foreground: "#0f766e",
      Icon: Sparkles,
    };
  }

  if (normalized.includes("pantry") || normalized.includes("hospitality")) {
    return {
      accent: "#d97706",
      background: "linear-gradient(145deg, #fff7ed 0%, #ffedd5 58%, #fed7aa 100%)",
      foreground: "#b45309",
      Icon: Coffee,
    };
  }

  if (normalized.includes("print") || normalized.includes("branding") || normalized.includes("marketing")) {
    return {
      accent: "#7c3aed",
      background: "linear-gradient(145deg, #faf5ff 0%, #ede9fe 58%, #ddd6fe 100%)",
      foreground: "#6d28d9",
      Icon: Printer,
    };
  }

  if (normalized.includes("office") || normalized.includes("stationery")) {
    return {
      accent: "#2563eb",
      background: "linear-gradient(145deg, #eff6ff 0%, #dbeafe 58%, #bfdbfe 100%)",
      foreground: "#1d4ed8",
      Icon: FileText,
    };
  }

  return {
    accent: "#475569",
    background: "linear-gradient(145deg, #f8fafc 0%, #e2e8f0 58%, #cbd5e1 100%)",
    foreground: "#334155",
    Icon: Package,
  };
}

export function ProductImage({
  product,
  style,
}: {
  product: ProductImageProduct;
  style?: CSSProperties;
}) {
  const { accent, background, foreground, Icon } = artworkFor(product.category);

  return (
    <div
      style={{
        alignItems: "center",
        aspectRatio: "16 / 10",
        background,
        borderBottom: "1px solid var(--slate-200)",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {product.hasImage ? (
        <img
          alt={product.imageAltText || product.name}
          loading="lazy"
          src={`/api/products/${encodeURIComponent(product.id)}/image`}
          style={{
            background: "white",
            height: "100%",
            objectFit: "contain",
            padding: 12,
            width: "100%",
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={`${product.name} product illustration`}
          style={{
            alignItems: "center",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            position: "absolute",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              background: "rgba(255,255,255,.68)",
              border: "1px solid rgba(255,255,255,.9)",
              borderRadius: 24,
              boxShadow: `0 18px 45px ${accent}26`,
              color: foreground,
              display: "grid",
              height: 92,
              placeItems: "center",
              transform: "rotate(-3deg)",
              width: 92,
            }}
          >
            <Icon size={43} strokeWidth={1.65} />
          </div>
        </div>
      )}

      <span
        className="status-badge"
        style={{
          background: "rgba(255,255,255,.84)",
          bottom: 13,
          color: foreground,
          left: 13,
          position: "absolute",
        }}
      >
        {product.category}
      </span>

      <span
        aria-hidden="true"
        style={{
          color: foreground,
          fontSize: 10,
          fontWeight: 850,
          letterSpacing: ".08em",
          opacity: 0.78,
          position: "absolute",
          right: 14,
          textTransform: "uppercase",
          top: 13,
        }}
      >
        {product.code}
      </span>
    </div>
  );
}
