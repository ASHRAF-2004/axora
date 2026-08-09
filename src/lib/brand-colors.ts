export const AXORA_BRAND = {
  primary: "#0B2D52",
  accent: "#E8A33D",
  white: "#FFFFFF",
} as const;

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface BrandThemeTokens {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  secondary: string;
  accent: string;
  primaryForeground: string;
  secondaryForeground: string;
  pageBackground: string;
  darkPageBackground: string;
  surface: string;
  darkSurface: string;
  mutedSurface: string;
  border: string;
  darkBorder: string;
  text: string;
  textInverse: string;
  icon: string;
  iconInverse: string;
  success: string;
  warning: string;
  danger: string;
  focusRing: string;
  link: string;
  chart: string[];
}

export interface BrandContrastSummary {
  primaryForeground: number;
  primaryHoverForeground: number;
  primaryActiveForeground: number;
  secondaryForeground: number;
  textOnBackground: number;
  textInverseOnDark: number;
  iconOnBackground: number;
  iconInverseOnDark: number;
  linkOnBackground: number;
  focusOnBackground: number;
  passes: boolean;
}

export interface BrandColorAnalysis {
  tokens: BrandThemeTokens;
  dominantColors: string[];
  sampledOpaquePixels: number;
  usedFallback: boolean;
  contrast: BrandContrastSummary;
}

export interface BrandThemeSeed {
  primary?: string;
  secondary?: string;
  accent?: string;
  pageBackground?: string;
  darkPageBackground?: string;
  surface?: string;
  darkSurface?: string;
  mutedSurface?: string;
  border?: string;
  darkBorder?: string;
  text?: string;
  textInverse?: string;
  icon?: string;
  iconInverse?: string;
}

export type BrandPaletteChoice =
  | "BALANCED"
  | "REVERSED"
  | "VIVID"
  | "AXORA_DEFAULT";

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex(color: RgbColor) {
  return "#" + [color.red, color.green, color.blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function hexToRgb(hex: string): RgbColor {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error("Expected a six-digit hexadecimal color.");
  }
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function normalizedHex(value: string) {
  return rgbToHex(hexToRgb(value));
}

function srgbToLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string | RgbColor) {
  const rgb = typeof color === "string" ? hexToRgb(color) : color;
  return 0.2126 * srgbToLinear(rgb.red)
    + 0.7152 * srgbToLinear(rgb.green)
    + 0.0722 * srgbToLinear(rgb.blue);
}

export function contrastRatio(first: string | RgbColor, second: string | RgbColor) {
  const firstLum = relativeLuminance(first);
  const secondLum = relativeLuminance(second);
  return (Math.max(firstLum, secondLum) + 0.05)
    / (Math.min(firstLum, secondLum) + 0.05);
}

function mix(first: RgbColor, second: RgbColor, amount: number): RgbColor {
  const safeAmount = Math.max(0, Math.min(1, amount));
  return {
    red: first.red * (1 - safeAmount) + second.red * safeAmount,
    green: first.green * (1 - safeAmount) + second.green * safeAmount,
    blue: first.blue * (1 - safeAmount) + second.blue * safeAmount,
  };
}

function saturation(color: RgbColor) {
  const channels = [color.red, color.green, color.blue].map((value) => value / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
}

function distance(first: RgbColor, second: RgbColor) {
  return Math.sqrt(
    (first.red - second.red) ** 2
      + (first.green - second.green) ** 2
      + (first.blue - second.blue) ** 2,
  );
}

function bestForeground(background: RgbColor) {
  const black = contrastRatio(background, "#0A1624");
  const white = contrastRatio(background, "#FFFFFF");
  return white >= black ? "#FFFFFF" : "#0A1624";
}

function ensureContrast(
  color: RgbColor,
  background: RgbColor,
  minimum: number,
) {
  if (contrastRatio(color, background) >= minimum) return color;
  const dark = hexToRgb("#0A1624");
  const light = hexToRgb("#FFFFFF");
  const target = contrastRatio(dark, background) >= contrastRatio(light, background)
    ? dark
    : light;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

function interactiveShade(color: string, foreground: string, amount: number) {
  const target = relativeLuminance(foreground) > 0.5 ? "#000000" : "#FFFFFF";
  return rgbToHex(ensureContrast(
    mix(hexToRgb(color), hexToRgb(target), amount),
    hexToRgb(foreground),
    4.5,
  ));
}

export function buildBrandThemeTokens(seed: BrandThemeSeed = {}): BrandThemeTokens {
  const pageBackground = normalizedHex(seed.pageBackground ?? "#F7F9FC");
  const darkPageBackground = normalizedHex(seed.darkPageBackground ?? "#0A1624");
  const surface = normalizedHex(seed.surface ?? "#FFFFFF");
  const darkSurface = normalizedHex(seed.darkSurface ?? "#12243A");
  const primary = rgbToHex(ensureContrast(
    hexToRgb(seed.primary ?? AXORA_BRAND.primary),
    hexToRgb(surface),
    3,
  ));
  const secondary = rgbToHex(ensureContrast(
    hexToRgb(seed.secondary ?? "#173F5F"),
    hexToRgb(surface),
    3,
  ));
  const accent = rgbToHex(ensureContrast(
    hexToRgb(seed.accent ?? AXORA_BRAND.accent),
    hexToRgb(surface),
    3,
  ));
  const primaryForeground = bestForeground(hexToRgb(primary));
  const secondaryForeground = bestForeground(hexToRgb(secondary));
  const link = rgbToHex(ensureContrast(hexToRgb(primary), hexToRgb(surface), 4.5));
  const focusRing = rgbToHex(ensureContrast(hexToRgb(accent), hexToRgb(surface), 3));

  return {
    primary,
    primaryHover: interactiveShade(primary, primaryForeground, 0.12),
    primaryActive: interactiveShade(primary, primaryForeground, 0.22),
    secondary,
    accent,
    primaryForeground,
    secondaryForeground,
    pageBackground,
    darkPageBackground,
    surface,
    darkSurface,
    mutedSurface: normalizedHex(seed.mutedSurface ?? "#EEF2F7"),
    border: normalizedHex(seed.border ?? "#D7DEE8"),
    darkBorder: normalizedHex(seed.darkBorder ?? "#31445A"),
    text: normalizedHex(seed.text ?? "#172033"),
    textInverse: normalizedHex(seed.textInverse ?? "#F4F7FB"),
    icon: normalizedHex(seed.icon ?? "#344054"),
    iconInverse: normalizedHex(seed.iconInverse ?? "#D7DEE8"),
    success: "#187A50",
    warning: "#9A5B08",
    danger: "#B4232C",
    focusRing,
    link,
    chart: [primary, accent, secondary, "#187A50", "#6D4CC7", "#2B7188"],
  };
}

function roundedContrast(first: string, second: string) {
  return Number(contrastRatio(first, second).toFixed(2));
}

export function brandContrastSummary(tokens: BrandThemeTokens): BrandContrastSummary {
  const summary = {
    primaryForeground: roundedContrast(tokens.primary, tokens.primaryForeground),
    primaryHoverForeground: roundedContrast(tokens.primaryHover, tokens.primaryForeground),
    primaryActiveForeground: roundedContrast(tokens.primaryActive, tokens.primaryForeground),
    secondaryForeground: roundedContrast(tokens.secondary, tokens.secondaryForeground),
    textOnBackground: roundedContrast(tokens.text, tokens.pageBackground),
    textInverseOnDark: roundedContrast(tokens.textInverse, tokens.darkPageBackground),
    iconOnBackground: roundedContrast(tokens.icon, tokens.pageBackground),
    iconInverseOnDark: roundedContrast(tokens.iconInverse, tokens.darkPageBackground),
    linkOnBackground: roundedContrast(tokens.link, tokens.surface),
    focusOnBackground: roundedContrast(tokens.focusRing, tokens.surface),
  };
  return {
    ...summary,
    passes: summary.primaryForeground >= 4.5
      && summary.primaryHoverForeground >= 4.5
      && summary.primaryActiveForeground >= 4.5
      && summary.secondaryForeground >= 4.5
      && summary.textOnBackground >= 4.5
      && summary.textInverseOnDark >= 4.5
      && summary.iconOnBackground >= 3
      && summary.iconInverseOnDark >= 3
      && summary.linkOnBackground >= 4.5
      && summary.focusOnBackground >= 3,
  };
}

export function brandThemeAlternates(tokens: BrandThemeTokens) {
  return {
    BALANCED: tokens,
    REVERSED: buildBrandThemeTokens({
      primary: tokens.secondary,
      secondary: tokens.primary,
      accent: tokens.accent,
      pageBackground: tokens.pageBackground,
      darkPageBackground: tokens.darkPageBackground,
      text: tokens.text,
      textInverse: tokens.textInverse,
      icon: tokens.icon,
      iconInverse: tokens.iconInverse,
    }),
    VIVID: buildBrandThemeTokens({
      primary: tokens.primary,
      secondary: tokens.accent,
      accent: tokens.secondary,
      pageBackground: tokens.pageBackground,
      darkPageBackground: tokens.darkPageBackground,
      text: tokens.text,
      textInverse: tokens.textInverse,
      icon: tokens.icon,
      iconInverse: tokens.iconInverse,
    }),
    AXORA_DEFAULT: buildBrandThemeTokens(),
  } satisfies Record<BrandPaletteChoice, BrandThemeTokens>;
}

interface PaletteEntry {
  color: RgbColor;
  count: number;
}

function quantizedPalette(
  pixels: Uint8Array | Uint8ClampedArray,
  channels: number,
) {
  const buckets = new Map<string, {
    red: number;
    green: number;
    blue: number;
    count: number;
  }>();
  let opaque = 0;
  const stride = Math.max(1, Math.floor(pixels.length / channels / 45_000));
  for (let pixel = 0; pixel < pixels.length / channels; pixel += stride) {
    const offset = pixel * channels;
    const alpha = channels >= 4 ? pixels[offset + 3] : 255;
    if (alpha < 160) continue;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const lum = relativeLuminance({ red, green, blue });
    if (lum > 0.97) continue;
    opaque += 1;
    const key = (red >> 4) + ":" + (green >> 4) + ":" + (blue >> 4);
    const current = buckets.get(key) ?? {
      red: 0, green: 0, blue: 0, count: 0,
    };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }
  const palette: PaletteEntry[] = [...buckets.values()]
    .map((bucket) => ({
      color: {
        red: bucket.red / bucket.count,
        green: bucket.green / bucket.count,
        blue: bucket.blue / bucket.count,
      },
      count: bucket.count,
    }))
    .sort((first, second) => second.count - first.count);
  return { palette, opaque };
}

export function analyzeLogoPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  channels: number,
): BrandColorAnalysis {
  if (![3, 4].includes(channels)) {
    throw new Error("Logo analysis requires RGB or RGBA pixels.");
  }
  const { palette, opaque } = quantizedPalette(pixels, channels);
  const fallbackPrimary = hexToRgb(AXORA_BRAND.primary);
  const fallbackAccent = hexToRgb(AXORA_BRAND.accent);
  const usable = palette.filter(({ color }) => relativeLuminance(color) > 0.015);
  const usedFallback = usable.length === 0;

  const primary = usedFallback
    ? fallbackPrimary
    : [...usable].sort((first, second) => {
      const firstScore = first.count * (0.55 + saturation(first.color))
        * (relativeLuminance(first.color) < 0.82 ? 1.2 : 0.55);
      const secondScore = second.count * (0.55 + saturation(second.color))
        * (relativeLuminance(second.color) < 0.82 ? 1.2 : 0.55);
      return secondScore - firstScore;
    })[0].color;

  const accentCandidate = usable
    .filter(({ color }) => distance(color, primary) >= 70)
    .sort((first, second) => {
      const firstScore = first.count * (0.35 + saturation(first.color))
        * distance(first.color, primary);
      const secondScore = second.count * (0.35 + saturation(second.color))
        * distance(second.color, primary);
      return secondScore - firstScore;
    })[0]?.color;
  const accent = accentCandidate
    ?? (saturation(primary) < 0.18
      ? fallbackAccent
      : mix(primary, fallbackAccent, 0.55));
  const secondary = mix(primary, hexToRgb("#F7F9FC"), 0.22);
  const tokens = buildBrandThemeTokens({
    primary: rgbToHex(primary),
    secondary: rgbToHex(secondary),
    accent: rgbToHex(accent),
  });

  return {
    tokens,
    dominantColors: (
      usedFallback
        ? [fallbackPrimary, fallbackAccent]
        : usable.slice(0, 8).map((entry) => entry.color)
    ).map(rgbToHex),
    sampledOpaquePixels: opaque,
    usedFallback,
    contrast: brandContrastSummary(tokens),
  };
}

export function themeCssVariables(tokens: BrandThemeTokens) {
  const entries: Array<[string, string]> = [
    ["--tenant-primary", tokens.primary],
    ["--tenant-primary-hover", tokens.primaryHover],
    ["--tenant-primary-active", tokens.primaryActive],
    ["--tenant-secondary", tokens.secondary],
    ["--tenant-accent", tokens.accent],
    ["--tenant-primary-foreground", tokens.primaryForeground],
    ["--tenant-secondary-foreground", tokens.secondaryForeground],
    ["--tenant-page", tokens.pageBackground],
    ["--tenant-page-dark", tokens.darkPageBackground],
    ["--tenant-surface", tokens.surface],
    ["--tenant-surface-dark", tokens.darkSurface],
    ["--tenant-muted", tokens.mutedSurface],
    ["--tenant-border", tokens.border],
    ["--tenant-border-dark", tokens.darkBorder],
    ["--tenant-text", tokens.text],
    ["--tenant-text-inverse", tokens.textInverse],
    ["--tenant-icon", tokens.icon],
    ["--tenant-icon-inverse", tokens.iconInverse],
    ["--tenant-success", tokens.success],
    ["--tenant-warning", tokens.warning],
    ["--tenant-danger", tokens.danger],
    ["--tenant-focus", tokens.focusRing],
    ["--tenant-link", tokens.link],
    ...tokens.chart.map((color, index) => [
      "--tenant-chart-" + (index + 1),
      color,
    ] as [string, string]),
  ];
  return entries.map(([name, value]) => name + ":" + value).join(";");
}
