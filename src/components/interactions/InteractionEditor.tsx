"use client";

import {
  Bot,
  Check,
  CheckCircle2,
  Gauge,
  Info,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  APPROVED_INTERACTION_CATALOG,
  DEFAULT_ABSTRACT_INTERACTION_CONFIG,
  DEFAULT_DISABLED_INTERACTION_CONFIG,
  DEFAULT_MASCOT_CONFIG,
  DEFAULT_RESTRAINED_MOTION_CONFIG,
  InteractionConfigSchema,
  validateInteractionForPublication,
  type ActiveInteractionConfig,
  type InteractionAssetId,
  type InteractionConfig,
  type InteractionRecommendation,
  type OwnerInteractionChoice,
} from "@/lib/interactions";
import {
  InteractionPreview,
  type InteractionPreviewMode,
  type InteractionPreviewWarning,
} from "./InteractionPreview";

type AsyncResult = unknown | void;

export interface InteractionEditorProps {
  recommendation: InteractionRecommendation;
  initialConfig: InteractionConfig;
  initialChoice?: OwnerInteractionChoice | null;
  companyName?: string;
  industry?: string;
  tagline?: string;
  canPublish?: boolean;
  saveAction?: (choice: OwnerInteractionChoice) => Promise<AsyncResult>;
  publishAction?: (config: InteractionConfig) => Promise<AsyncResult>;
  clearOverrideAction?: () => Promise<AsyncResult>;
  regenerateAction?: () => Promise<
    | InteractionRecommendation
    | { recommendation: InteractionRecommendation | null }
    | null
    | void
  >;
  onConfigChange?: (config: InteractionConfig) => void;
}

const runtimeAssets = Object.values(APPROVED_INTERACTION_CATALOG).filter(
  (asset) => asset.purpose === "runtime" || asset.purpose === "both",
);

function cloneConfig<T extends InteractionConfig>(config: T): T {
  return structuredClone(config);
}

function configsMatch(first: InteractionConfig, second: InteractionConfig) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function conceptForAsset(
  assetId: Exclude<InteractionAssetId, "none">,
  current: InteractionConfig,
): InteractionConfig {
  const base = assetId === "axora-buddy-v1"
    ? cloneConfig(DEFAULT_MASCOT_CONFIG)
    : assetId === "axora-orbit-v1"
      ? cloneConfig(DEFAULT_ABSTRACT_INTERACTION_CONFIG)
      : cloneConfig(DEFAULT_RESTRAINED_MOTION_CONFIG);

  if (!current.enabled) return base;
  return {
    ...base,
    scale: current.scale,
    colorTreatment: current.colorTreatment,
    semanticRole: current.semanticRole,
    accessibleLabel: current.semanticRole === "informative"
      ? current.accessibleLabel ?? "An interactive company illustration."
      : null,
  };
}

function decisionFor(
  config: InteractionConfig,
  recommendation: InteractionRecommendation,
): OwnerInteractionChoice["decision"] {
  if (!config.enabled) return "disabled";
  if (configsMatch(config, recommendation.config)) return "accepted";
  if (recommendation.config.assetId !== config.assetId) return "replaced";
  return "customized";
}

function ToggleField({
  checked,
  disabled = false,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="interaction-toggle-field">
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function RecommendationMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="interaction-recommendation-metric">
      <span>{label}</span>
      <strong>{value}%</strong>
      <div aria-hidden="true"><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export function InteractionEditor({
  recommendation: initialRecommendation,
  initialConfig,
  initialChoice = null,
  companyName,
  industry,
  tagline,
  canPublish = false,
  saveAction,
  publishAction,
  clearOverrideAction,
  regenerateAction,
  onConfigChange,
}: InteractionEditorProps) {
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [config, setConfigState] = useState(() => cloneConfig(initialConfig));
  const [savedConfig, setSavedConfig] = useState(() => cloneConfig(initialChoice?.config ?? initialConfig));
  const [previewMode, setPreviewMode] = useState<InteractionPreviewMode>("desktop");
  const [pending, setPending] = useState<"save" | "publish" | "regenerate" | "reset" | null>(null);
  const [status, setStatus] = useState(
    initialChoice
      ? `Owner ${initialChoice.decision} this configuration.`
      : saveAction
        ? "AI recommendation ready for owner review."
        : "Local preview only — saving and publishing are unavailable.",
  );

  const setConfig = (next: InteractionConfig) => {
    setConfigState(next);
    onConfigChange?.(next);
  };

  const isDirty = !configsMatch(config, savedConfig);
  const differsFromRecommendation = !configsMatch(config, recommendation.config);
  const active = config.enabled ? config : null;
  const publication = useMemo(() => validateInteractionForPublication(config), [config]);
  const publicationWarnings = useMemo<InteractionPreviewWarning[]>(
    () => publication.issues.map((issue) => ({
      id: `publication-${issue.code}`,
      label: issue.severity === "error" ? "Publishing check failed" : "Publishing review",
      detail: issue.message,
      tone: "warning",
    })),
    [publication.issues],
  );

  const updateActive = <K extends keyof ActiveInteractionConfig>(
    key: K,
    value: ActiveInteractionConfig[K],
  ) => {
    if (!config.enabled) return;
    setConfig({ ...config, [key]: value } as ActiveInteractionConfig);
  };

  const acceptRecommendation = () => {
    setConfig(cloneConfig(recommendation.config));
    setStatus("AI recommendation accepted in the unpublished preview.");
  };

  const tryAnotherConcept = async () => {
    const availableAlternatives = recommendation.alternativeAssetIds.filter(
      (id): id is Exclude<InteractionAssetId, "none"> => id !== "none" && id !== config.assetId
        && id !== "axora-mark-static-v1",
    );
    const nextAsset = availableAlternatives[0]
      ?? runtimeAssets.find((candidate) => candidate.id !== config.assetId)?.id;

    if (nextAsset) {
      setConfig(conceptForAsset(nextAsset, config));
      setStatus(`Previewing ${APPROVED_INTERACTION_CATALOG[nextAsset].displayName}; the AI output remains unchanged.`);
      return;
    }
    if (!regenerateAction) {
      setStatus("No additional approved concept is available for this recommendation.");
      return;
    }

    setPending("regenerate");
    try {
      const result = await regenerateAction();
      const nextRecommendation = result && "recommendation" in result
        ? result.recommendation
        : result && "config" in result
          ? result
          : null;
      if (nextRecommendation) {
        setRecommendation(nextRecommendation);
        setConfig(cloneConfig(nextRecommendation.config));
        setStatus("A fresh server-verified recommendation is ready for review.");
      } else {
        setStatus("Recommendation refreshed. Reload to see the latest server result.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The recommendation could not be refreshed.");
    } finally {
      setPending(null);
    }
  };

  const reduceMotion = () => {
    if (!config.enabled) return;
    setConfig({
      ...config,
      intensity: "subtle",
      automaticMovement: false,
      desktopBehavior: "reduced",
      mobileBehavior: "static",
      reducedMotionBehavior: "static",
      performanceTier: config.assetId === "axora-buddy-v1" ? "balanced" : "low",
    });
    setPreviewMode("reduced-motion");
    setStatus("Motion reduced; the static fallback is shown in preview.");
  };

  const disableInteraction = () => {
    setConfig(cloneConfig(DEFAULT_DISABLED_INTERACTION_CONFIG));
    setStatus("Interactive experience disabled in the unpublished preview.");
  };

  const resetToRecommendation = async () => {
    setConfig(cloneConfig(recommendation.config));
    setPending("reset");
    try {
      if (clearOverrideAction) await clearOverrideAction();
      setSavedConfig(cloneConfig(recommendation.config));
      setStatus(clearOverrideAction
        ? "Owner override cleared; the AI recommendation is active again."
        : "Reset to the original AI recommendation in this local preview.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The saved override could not be cleared.");
    } finally {
      setPending(null);
    }
  };

  const saveDraft = async () => {
    const parsed = InteractionConfigSchema.safeParse(config);
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "The configuration is invalid.");
      return;
    }
    if (!saveAction) {
      setSavedConfig(cloneConfig(parsed.data));
      setStatus("Local preview updated. It has not been saved to the production workspace.");
      return;
    }

    const choice: OwnerInteractionChoice = {
      schemaVersion: 1,
      recommendationId: recommendation.recommendationId,
      decision: decisionFor(parsed.data, recommendation),
      config: parsed.data,
      savedAt: new Date().toISOString(),
    };
    setPending("save");
    try {
      await saveAction(choice);
      setSavedConfig(cloneConfig(parsed.data));
      setStatus("Owner override saved as an unpublished draft.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The draft could not be saved.");
    } finally {
      setPending(null);
    }
  };

  const publish = async () => {
    if (!publishAction || !canPublish) {
      setStatus("Publishing is unavailable for this workspace or account.");
      return;
    }
    if (!publication.valid) {
      setStatus(publication.errors[0]?.message ?? "Resolve the publishing checks first.");
      return;
    }

    setPending("publish");
    try {
      await publishAction(config);
      setSavedConfig(cloneConfig(config));
      setStatus("Interactive experience published successfully.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The experience could not be published.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="interaction-editor" data-testid="interaction-editor">
      <section className="interaction-recommendation-panel" aria-labelledby="interaction-recommendation-title">
        <div className="interaction-recommendation-symbol"><Sparkles aria-hidden="true" size={28} /></div>
        <div className="interaction-recommendation-content">
          <div className="interaction-recommendation-heading">
            <div>
              <span className="interaction-overline">AI design recommendation</span>
              <h2 id="interaction-recommendation-title">
                {recommendation.config.enabled
                  ? APPROVED_INTERACTION_CATALOG[recommendation.config.assetId].displayName
                  : "No interactive experience"}
              </h2>
            </div>
            <span className={`status-badge status-${recommendation.confidence === "high" ? "success" : "info"}`}>
              {recommendation.confidence} confidence
            </span>
          </div>
          <p>{recommendation.rationale}</p>
          <div className="interaction-recommendation-metrics" aria-label="Recommendation evidence">
            <RecommendationMetric label="Tone fit" value={recommendation.metrics.toneFit} />
            <RecommendationMetric label="Accessibility" value={recommendation.metrics.accessibilityFit} />
            <RecommendationMetric label="Performance" value={recommendation.metrics.performanceFit} />
            <div className="interaction-license-summary">
              <CheckCircle2 aria-hidden="true" size={17} />
              <span><strong>Original Axora asset</strong>Commercial use approved</span>
            </div>
          </div>
          <div className="interaction-recommendation-actions">
            <button className="button button-primary" data-ux-silent="true" onClick={acceptRecommendation} type="button">
              <Check aria-hidden="true" size={16} />Accept recommendation
            </button>
            <button className="button button-secondary" data-ux-silent="true" disabled={pending === "regenerate"} onClick={tryAnotherConcept} type="button">
              <RefreshCw aria-hidden="true" className={pending === "regenerate" ? "ux-spin" : undefined} size={16} />Try another concept
            </button>
            <button className="button button-secondary" data-ux-silent="true" disabled={!config.enabled} onClick={reduceMotion} type="button">
              <Gauge aria-hidden="true" size={16} />Reduce motion
            </button>
            <button className="interaction-text-danger" data-ux-silent="true" disabled={!config.enabled} onClick={disableInteraction} type="button">
              <X aria-hidden="true" size={16} />Disable
            </button>
          </div>
        </div>
      </section>

      <div className="interaction-editor-workbench">
        <aside className="interaction-config-panel" aria-label="Interaction configuration">
          <div className="interaction-config-heading">
            <div>
              <span className="interaction-overline">Owner settings</span>
              <h2>Current configuration</h2>
            </div>
            <span className={`status-badge ${differsFromRecommendation ? "status-warning" : "status-info"}`}>
              {differsFromRecommendation ? "Owner override" : "AI default"}
            </span>
          </div>

          <div className="interaction-config-scroll">
            <fieldset className="interaction-control-group">
              <legend>Experience</legend>
              <ToggleField
                checked={config.enabled}
                hint="Optional and independent from website content"
                label="Enable interactive experience"
                onChange={(enabled) => setConfig(enabled
                  ? cloneConfig(recommendation.config.enabled ? recommendation.config : DEFAULT_MASCOT_CONFIG)
                  : cloneConfig(DEFAULT_DISABLED_INTERACTION_CONFIG))}
              />

              {active ? (
                <>
                  <label>
                    <span>Approved asset</span>
                    <select
                      aria-label="Approved asset"
                      onChange={(event) => setConfig(conceptForAsset(event.target.value as Exclude<InteractionAssetId, "none">, config))}
                      value={active.assetId}
                    >
                      {runtimeAssets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>
                      Size
                      <span aria-hidden="true" className="interaction-control-value">
                        {Math.round(active.scale * 100)}%
                      </span>
                    </span>
                    <input
                      aria-label="Interaction size"
                      max="1.5"
                      min="0.5"
                      onChange={(event) => updateActive("scale", Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={active.scale}
                    />
                  </label>
                  <label>
                    <span>Color treatment</span>
                    <select aria-label="Color treatment" onChange={(event) => updateActive("colorTreatment", event.target.value as ActiveInteractionConfig["colorTreatment"])} value={active.colorTreatment}>
                      <option value="brand">Brand colors</option>
                      <option value="neutral">Neutral</option>
                      <option value="monochrome">Monochrome</option>
                      <option value="high-contrast">High contrast</option>
                    </select>
                  </label>
                </>
              ) : null}
            </fieldset>

            {active ? (
              <>
                <fieldset className="interaction-control-group">
                  <legend>Behaviour</legend>
                  <label>
                    <span>Animation intensity</span>
                    <select aria-label="Animation intensity" onChange={(event) => updateActive("intensity", event.target.value as ActiveInteractionConfig["intensity"])} value={active.intensity}>
                      <option value="subtle">Subtle</option>
                      <option value="moderate">Moderate</option>
                      <option value="lively">Lively</option>
                    </select>
                  </label>
                  <ToggleField
                    checked={active.automaticMovement}
                    disabled={active.assetId !== "axora-buddy-v1"}
                    label="Automatic movement"
                    onChange={(checked) => updateActive("automaticMovement", checked)}
                  />
                  <ToggleField
                    checked={active.dragEnabled}
                    disabled={active.assetId !== "axora-buddy-v1"}
                    hint="Mouse, touch, and pointer input"
                    label="Allow visitor drag"
                    onChange={(checked) => updateActive("dragEnabled", checked)}
                  />
                  <ToggleField checked={active.reactionsEnabled} label="Approved reactions" onChange={(checked) => updateActive("reactionsEnabled", checked)} />
                  <label>
                    <span>
                      Walking speed
                      <span aria-hidden="true" className="interaction-control-value">
                        {active.walkingSpeed} px/s
                      </span>
                    </span>
                    <input
                      aria-label="Walking speed"
                      disabled={active.assetId !== "axora-buddy-v1"}
                      max="120"
                      min="8"
                      onChange={(event) => updateActive("walkingSpeed", Number(event.target.value))}
                      step="2"
                      type="range"
                      value={active.walkingSpeed}
                    />
                  </label>
                  <label>
                    <span>
                      Resume delay
                      <span aria-hidden="true" className="interaction-control-value">
                        {active.resumeDelayMs} ms
                      </span>
                    </span>
                    <input
                      aria-label="Resume delay"
                      max="5000"
                      min="200"
                      onChange={(event) => updateActive("resumeDelayMs", Number(event.target.value))}
                      step="100"
                      type="range"
                      value={active.resumeDelayMs}
                    />
                  </label>
                </fieldset>

                <fieldset className="interaction-control-group">
                  <legend>Placement &amp; boundaries</legend>
                  <label>
                    <span>Starting location</span>
                    <select aria-label="Starting location" onChange={(event) => updateActive("initialPlacement", event.target.value as ActiveInteractionConfig["initialPlacement"])} value={active.initialPlacement}>
                      <option value="hero-left">Hero left</option>
                      <option value="hero-right">Hero right</option>
                      <option value="feature-area">Feature area</option>
                      <option value="inline">Inline</option>
                      <option value="fixed-bottom-left">Fixed bottom left</option>
                      <option value="fixed-bottom-right">Fixed bottom right</option>
                    </select>
                  </label>
                  <label>
                    <span>Permitted movement region</span>
                    <select aria-label="Permitted movement region" onChange={(event) => updateActive("permittedRegion", event.target.value as ActiveInteractionConfig["permittedRegion"])} value={active.permittedRegion}>
                      <option value="hero">Hero only</option>
                      <option value="features">Feature sections</option>
                      <option value="showcase">Product showcase</option>
                      <option value="footer">Footer area</option>
                    </select>
                  </label>
                  <div className="interaction-locked-zones">
                    <LockKeyhole aria-hidden="true" size={16} />
                    <span><strong>Protected by Axora</strong>Navigation, forms, CTAs, consent, and legal content cannot be covered.</span>
                  </div>
                </fieldset>

                <fieldset className="interaction-control-group">
                  <legend>Devices &amp; performance</legend>
                  <label>
                    <span>Desktop behavior</span>
                    <select aria-label="Desktop behavior" onChange={(event) => updateActive("desktopBehavior", event.target.value as ActiveInteractionConfig["desktopBehavior"])} value={active.desktopBehavior}>
                      <option value="full">Full experience</option>
                      <option value="reduced">Reduced motion</option>
                      <option value="static">Static only</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </label>
                  <label>
                    <span>Mobile behavior</span>
                    <select aria-label="Mobile behavior" onChange={(event) => updateActive("mobileBehavior", event.target.value as ActiveInteractionConfig["mobileBehavior"])} value={active.mobileBehavior}>
                      <option value="full">Full experience</option>
                      <option value="reduced">Reduced motion</option>
                      <option value="static">Static only</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </label>
                  <label>
                    <span>Performance tier</span>
                    <select aria-label="Performance tier" onChange={(event) => updateActive("performanceTier", event.target.value as ActiveInteractionConfig["performanceTier"])} value={active.performanceTier}>
                      <option value="low">Low cost</option>
                      <option value="balanced">Balanced</option>
                      <option value="rich">Rich</option>
                    </select>
                  </label>
                </fieldset>

                <fieldset className="interaction-control-group">
                  <legend>Accessibility &amp; fallback</legend>
                  <label>
                    <span>Reduced-motion behavior</span>
                    <select aria-label="Reduced-motion behavior" onChange={(event) => updateActive("reducedMotionBehavior", event.target.value as ActiveInteractionConfig["reducedMotionBehavior"])} value={active.reducedMotionBehavior}>
                      <option value="static">Show static fallback</option>
                      <option value="hidden">Hide interaction</option>
                    </select>
                  </label>
                  <label>
                    <span>Runtime fallback</span>
                    <select
                      aria-label="Runtime fallback"
                      onChange={(event) => {
                        const kind = event.target.value;
                        updateActive("fallback", kind === "hidden"
                          ? { kind: "hidden", assetId: "none" }
                          : {
                            kind: "static-svg",
                            assetId: APPROVED_INTERACTION_CATALOG[active.assetId].fallbackAssetId,
                          });
                      }}
                      value={active.fallback.kind === "hidden" ? "hidden" : "static"}
                    >
                      <option value="static">Approved static fallback</option>
                      <option value="hidden">No fallback (cannot publish)</option>
                    </select>
                  </label>
                  <label>
                    <span>Semantic role</span>
                    <select
                      aria-label="Semantic role"
                      onChange={(event) => {
                        const semanticRole = event.target.value as ActiveInteractionConfig["semanticRole"];
                        setConfig({
                          ...active,
                          semanticRole,
                          accessibleLabel: semanticRole === "informative"
                            ? active.accessibleLabel ?? "An interactive company illustration."
                            : null,
                        });
                      }}
                      value={active.semanticRole}
                    >
                      <option value="decorative">Decorative</option>
                      <option value="informative">Informative</option>
                    </select>
                  </label>
                  {active.semanticRole === "informative" ? (
                    <label>
                      <span>Accessible description</span>
                      <textarea
                        aria-label="Accessible description"
                        maxLength={160}
                        onChange={(event) => updateActive("accessibleLabel", event.target.value)}
                        rows={3}
                        value={active.accessibleLabel ?? ""}
                      />
                      <small className="form-hint">Describe the meaning, not every visual detail. Maximum 160 characters.</small>
                    </label>
                  ) : null}
                  <ToggleField checked={active.allowVisitorPause} label="Visitor pause control" onChange={(checked) => updateActive("allowVisitorPause", checked)} />
                  <ToggleField checked={active.allowVisitorDismiss} label="Visitor dismiss control" onChange={(checked) => updateActive("allowVisitorDismiss", checked)} />
                </fieldset>
              </>
            ) : (
              <div className="interaction-disabled-note">
                <Bot aria-hidden="true" size={20} />
                <p><strong>No runtime will load.</strong>The company website and all content remain available without animation.</p>
              </div>
            )}
          </div>

          <button className="interaction-reset-button" data-ux-silent="true" disabled={pending === "reset"} onClick={resetToRecommendation} type="button">
            <RotateCcw aria-hidden="true" className={pending === "reset" ? "ux-spin" : undefined} size={15} />Reset to AI recommendation
          </button>
        </aside>

        <InteractionPreview
          companyName={companyName}
          config={config}
          industry={industry}
          mode={previewMode}
          onModeChange={setPreviewMode}
          tagline={tagline}
          warnings={publicationWarnings}
        />
      </div>

      <footer className="interaction-editor-footer">
        <div className="interaction-editor-status" aria-live="polite" role="status">
          {publication.valid ? <CheckCircle2 aria-hidden="true" size={20} /> : <TriangleAlert aria-hidden="true" size={20} />}
          <span>
            <strong>{isDirty ? "Unpublished changes" : "Preview synchronized"}</strong>
            {status}
          </span>
        </div>
        <div className="interaction-editor-footer-actions">
          <button className="button button-secondary" data-ux-silent="true" disabled={!isDirty || pending !== null} onClick={() => setConfig(cloneConfig(savedConfig))} type="button">
            <RotateCcw aria-hidden="true" size={16} />Undo changes
          </button>
          <button className="button button-secondary" data-ux-silent="true" disabled={pending !== null} onClick={saveDraft} type="button">
            <Save aria-hidden="true" size={16} />{saveAction ? "Save draft" : "Keep local preview"}
          </button>
          <button
            aria-describedby={!publishAction || !canPublish ? "interaction-publish-help" : undefined}
            className="button button-primary"
            data-ux-silent="true"
            disabled={!publishAction || !canPublish || !publication.valid || pending !== null}
            onClick={publish}
            type="button"
          >
            <WandSparkles aria-hidden="true" size={16} />Publish interaction
          </button>
        </div>
        {!publishAction || !canPublish ? (
          <p className="interaction-publish-help" id="interaction-publish-help">
            <Info aria-hidden="true" size={14} />Publishing is unavailable; preview controls remain fully usable.
          </p>
        ) : null}
      </footer>
    </div>
  );
}
