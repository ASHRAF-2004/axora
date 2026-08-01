"use client";

import {
  CheckCircle2,
  Gauge,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
  TriangleAlert,
  EyeOff,
} from "lucide-react";
import type { InteractionConfig } from "@/lib/interactions/schema";
import { APPROVED_INTERACTION_CATALOG } from "@/lib/interactions/catalog";
import {
  TrustedInteractionRenderer,
  type InteractionRuntimeMode,
} from "./TrustedInteractionRenderer";

export type InteractionPreviewMode =
  | "desktop"
  | "tablet"
  | "mobile"
  | "reduced-motion"
  | "low-performance";

export interface InteractionPreviewWarning {
  id: string;
  label: string;
  detail: string;
  tone: "pass" | "warning";
}

export interface InteractionPreviewProps {
  config: InteractionConfig;
  mode: InteractionPreviewMode;
  onModeChange: (mode: InteractionPreviewMode) => void;
  warnings?: readonly InteractionPreviewWarning[];
  companyName?: string;
  industry?: string;
  tagline?: string;
}

const previewModes = [
  { id: "desktop", label: "Preview desktop", shortLabel: "Desktop", icon: Monitor },
  { id: "tablet", label: "Preview tablet", shortLabel: "Tablet", icon: Tablet },
  { id: "mobile", label: "Preview mobile", shortLabel: "Mobile", icon: Smartphone },
  { id: "reduced-motion", label: "Preview reduced motion", shortLabel: "Reduced motion", icon: EyeOff },
  { id: "low-performance", label: "Preview low performance", shortLabel: "Low performance", icon: Gauge },
] as const;

function runtimeModeFor(mode: InteractionPreviewMode): InteractionRuntimeMode {
  if (mode === "reduced-motion") return "reduced-motion";
  if (mode === "low-performance") return "low-performance";
  return "standard";
}

function viewportFor(mode: InteractionPreviewMode) {
  return mode === "tablet" || mode === "mobile" ? mode : "desktop";
}

function builtInChecks(config: InteractionConfig): InteractionPreviewWarning[] {
  if (!config.enabled) {
    return [
      {
        id: "disabled",
        label: "Interaction disabled",
        detail: "The website remains fully usable without the optional experience.",
        tone: "pass",
      },
    ];
  }

  const asset = APPROVED_INTERACTION_CATALOG[config.assetId];
  const checks: InteractionPreviewWarning[] = [
    {
      id: "license",
      label: "License approved",
      detail: `${asset.license.name}; commercial use is approved.`,
      tone: "pass",
    },
    {
      id: "asset-size",
      label: "Asset size within budget",
      detail: `${Math.ceil(asset.performance.estimatedAssetBytes / 1_000)} KB estimated local asset size.`,
      tone: "pass",
    },
    {
      id: "protected-zones",
      label: "Protected controls clear",
      detail: "Navigation, forms, calls to action, consent, and legal zones remain interactive.",
      tone: config.protectedZones.length === 5 ? "pass" : "warning",
    },
    {
      id: "fallback",
      label: config.fallback.kind === "hidden" ? "Static fallback required" : "Static fallback ready",
      detail: config.fallback.kind === "hidden"
        ? "Publication requires an approved static fallback for reduced motion and runtime failure."
        : "A trusted local static representation is available.",
      tone: config.fallback.kind === "hidden" ? "warning" : "pass",
    },
  ];

  if (config.mobileBehavior === "full" && config.intensity === "lively") {
    checks.push({
      id: "mobile-performance",
      label: "Review mobile intensity",
      detail: "Full lively motion may be distracting or costly on smaller devices.",
      tone: "warning",
    });
  }
  if (config.semanticRole === "informative" && !config.accessibleLabel) {
    checks.push({
      id: "accessible-label",
      label: "Accessible label required",
      detail: "Meaningful artwork needs a concise text equivalent before publication.",
      tone: "warning",
    });
  }

  return checks;
}

export function InteractionPreview({
  config,
  mode,
  onModeChange,
  warnings,
  companyName = "Your company",
  industry = "Technology services",
  tagline = "Make complex work feel simple.",
}: InteractionPreviewProps) {
  const checks = [...builtInChecks(config), ...(warnings ?? [])];
  const viewport = viewportFor(mode);

  return (
    <section className="interaction-preview-workspace" aria-label="Live interactive experience preview">
      <div className="interaction-preview-toolbar" role="toolbar" aria-label="Preview conditions">
        {previewModes.map(({ id, label, shortLabel, icon: Icon }) => (
          <button
            aria-label={label}
            aria-pressed={mode === id}
            className="interaction-preview-mode"
            data-active={mode === id ? "true" : "false"}
            data-ux-silent="true"
            key={id}
            onClick={() => onModeChange(id)}
            type="button"
          >
            <Icon aria-hidden="true" size={15} />
            <span>{shortLabel}</span>
          </button>
        ))}
      </div>

      <div
        className="interaction-preview-shell"
        data-mode={mode}
        data-testid="interaction-preview"
        data-viewport={viewport}
      >
        <div className="interaction-preview-browserbar" aria-hidden="true">
          <span />
          <span />
          <span />
          <div>company.example</div>
        </div>

        <div className="interaction-preview-site" data-interaction-surface>
          <nav aria-label="Preview website navigation" className="interaction-demo-nav" data-protected-zone="primary-navigation">
            <div className="interaction-demo-brand">
              <span aria-hidden="true">A</span>
              <strong>{companyName}</strong>
            </div>
            <div aria-hidden="true" className="interaction-demo-links">
              <span>Services</span>
              <span>Work</span>
              <span>About</span>
            </div>
            <button data-protected-zone="calls-to-action" data-testid="preview-nav-cta" type="button">Talk to us</button>
          </nav>

          <div className="interaction-demo-hero">
            <div className="interaction-demo-copy">
              <small>{industry}</small>
              <h2>{tagline}</h2>
              <p>Secure digital systems designed around your team, your customers, and the way you actually work.</p>
              <div data-protected-zone="calls-to-action">
                <button data-testid="preview-primary-cta" type="button">Explore services</button>
                <button type="button">See our work</button>
              </div>
            </div>
            <div className="interaction-demo-visual" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>

          <TrustedInteractionRenderer config={config} mode={runtimeModeFor(mode)} />

          <div className="interaction-preview-safety" aria-label="Preview validation summary">
            {checks.slice(0, 4).map((check) => {
              const Icon = check.tone === "pass" ? CheckCircle2 : TriangleAlert;
              return (
                <span data-tone={check.tone} key={check.id} title={check.detail}>
                  <Icon aria-hidden="true" size={13} />
                  {check.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="interaction-validation-list" aria-label="Interaction checks">
        {checks.map((check) => {
          const Icon = check.tone === "pass" ? ShieldCheck : TriangleAlert;
          return (
            <article data-tone={check.tone} key={check.id}>
              <Icon aria-hidden="true" size={17} />
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
