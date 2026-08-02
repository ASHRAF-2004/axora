"use client";

/* eslint-disable @next/next/no-img-element */

import type { Product, ProductImageSummary } from "@/lib/types";
import { ChevronLeft, ChevronRight, Coffee, FileText, Package, Printer, Sparkles, type LucideIcon } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";

type ProductImageProduct = Pick<Product, "category" | "code" | "hasImage" | "id" | "imageAltText" | "name">;

type Artwork = {
  accent: string;
  background: string;
  foreground: string;
  Icon: LucideIcon;
};

type GalleryImage = ProductImageSummary & { legacy?: boolean };

type LoadedGallery = {
  productId: string;
  images: ProductImageSummary[];
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

function stopCardNavigation(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export function ProductImage({
  product,
  showControls = true,
  style,
  locale = "en",
}: {
  product: ProductImageProduct;
  showControls?: boolean;
  style?: CSSProperties;
  locale?: SupportedLocale;
}) {
  const copy = corePortalMessages(locale).products;
  const { accent, background, foreground, Icon } = artworkFor(product.category);
  const fallbackImages = useMemo<GalleryImage[]>(() => product.hasImage ? [{
    id: "legacy-primary",
    altText: product.imageAltText || product.name,
    isPrimary: true,
    sortOrder: 0,
    legacy: true,
  }] : [], [product.hasImage, product.imageAltText, product.name]);
  const [loadedGallery, setLoadedGallery] = useState<LoadedGallery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!product.hasImage) return;

    const controller = new AbortController();
    fetch(`/api/products/${encodeURIComponent(product.id)}/images`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Gallery unavailable")))
      .then((payload: { images?: ProductImageSummary[] }) => {
        if (payload.images?.length) {
          setLoadedGallery({ productId: product.id, images: payload.images });
          setActiveIndex(0);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [product.hasImage, product.id]);

  const images: GalleryImage[] = loadedGallery?.productId === product.id && loadedGallery.images.length
    ? loadedGallery.images
    : fallbackImages;
  const boundedIndex = images.length ? activeIndex % images.length : 0;

  useEffect(() => {
    if (!showControls || images.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [images.length, showControls]);

  const current = images[boundedIndex] ?? images[0];
  const imageSource = current?.legacy
    ? `/api/products/${encodeURIComponent(product.id)}/image`
    : current
      ? `/api/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(current.id)}`
      : "";
  const controlsVisible = showControls && images.length > 1;

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
      {current ? (
        <img
          alt={current.altText || product.name}
          key={current.id}
          loading="lazy"
          src={imageSource}
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

      {controlsVisible ? (
        <>
          <button
            aria-label={copy.previousImage(product.name)}
            onClick={(event) => {
              stopCardNavigation(event);
              setActiveIndex((currentIndex) => (currentIndex - 1 + images.length) % images.length);
            }}
            style={{
              alignItems: "center",
              background: "rgba(255,255,255,.9)",
              border: "1px solid rgba(148,163,184,.5)",
              borderRadius: 999,
              display: "flex",
              height: 32,
              justifyContent: "center",
              insetInlineStart: 10,
              padding: 0,
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              width: 32,
              zIndex: 2,
            }}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={17} />
          </button>
          <button
            aria-label={copy.nextImage(product.name)}
            onClick={(event) => {
              stopCardNavigation(event);
              setActiveIndex((currentIndex) => (currentIndex + 1) % images.length);
            }}
            style={{
              alignItems: "center",
              background: "rgba(255,255,255,.9)",
              border: "1px solid rgba(148,163,184,.5)",
              borderRadius: 999,
              display: "flex",
              height: 32,
              justifyContent: "center",
              padding: 0,
              position: "absolute",
              insetInlineEnd: 10,
              top: "50%",
              transform: "translateY(-50%)",
              width: 32,
              zIndex: 2,
            }}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={17} />
          </button>
          <div
            aria-label={copy.imageCount(images.length)}
            style={{
              insetBlockEnd: 12,
              display: "flex",
              gap: 5,
              insetInlineStart: "50%",
              position: "absolute",
              transform: "translateX(-50%)",
              zIndex: 2,
            }}
          >
            {images.map((image, index) => (
              <button
                aria-label={copy.showImage(index + 1, images.length)}
                key={image.id}
                onClick={(event) => {
                  stopCardNavigation(event);
                  setActiveIndex(index);
                }}
                style={{
                  background: index === boundedIndex ? foreground : "rgba(255,255,255,.9)",
                  border: "1px solid rgba(15,23,42,.25)",
                  borderRadius: 999,
                  height: 8,
                  padding: 0,
                  width: 8,
                }}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}

      <span
        className="status-badge"
        style={{
          background: "rgba(255,255,255,.84)",
          insetBlockEnd: 13,
          color: foreground,
          insetInlineStart: 13,
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
          insetInlineEnd: 14,
          textTransform: "uppercase",
          top: 13,
        }}
      >
        {product.code}
      </span>
    </div>
  );
}
