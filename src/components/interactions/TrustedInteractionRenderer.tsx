"use client";

import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { Pause, Play, X } from "lucide-react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  InteractionConfigSchema,
  createInitialMascotMachine,
  transitionMascot,
  type ActiveInteractionConfig,
  type InteractionConfig,
  type MascotEffect,
  type MascotEnvironment,
  type MascotEvent,
  type MascotMachine,
  type MovementBounds,
  type Point,
  type ProtectedRect,
} from "@/lib/interactions";
import { AxoraBuddy } from "./AxoraBuddy";

export type InteractionRuntimeMode =
  | "standard"
  | "reduced-motion"
  | "low-performance";

export interface TrustedInteractionRendererProps {
  config: InteractionConfig;
  mode?: InteractionRuntimeMode;
  paused?: boolean;
  className?: string;
  onDismiss?: () => void;
}

const EMPTY_BOUNDS: MovementBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

function placementFraction(placement: InteractionConfig["initialPlacement"]) {
  if (placement === "hero-left" || placement === "fixed-bottom-left") return 0.08;
  if (placement === "inline" || placement === "feature-area") return 0.48;
  return 0.82;
}

function behaviorForViewport(config: ActiveInteractionConfig) {
  if (typeof window === "undefined") return config.desktopBehavior;
  return window.matchMedia("(max-width: 760px)").matches
    ? config.mobileBehavior
    : config.desktopBehavior;
}

function InvalidStaticFallback() {
  return (
    <div className="interaction-static-fallback" data-fallback-reason="invalid-config">
      <svg aria-hidden="true" className="interaction-static-mark" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="20" fill="#102a43" />
        <path d="m16 43 16-28 16 28h-9l-7-13-7 13z" fill="#60a5fa" />
        <circle cx="32" cy="43" r="5" fill="#2dd4bf" />
      </svg>
      <span className="interaction-visually-hidden">Static Axora illustration</span>
    </div>
  );
}

function StaticInteractionFallback({
  config,
  reason,
}: {
  config: ActiveInteractionConfig;
  reason: string;
}) {
  if (config.fallback.kind === "hidden") return null;

  return (
    <div
      aria-hidden={config.semanticRole === "decorative" ? "true" : undefined}
      aria-label={config.semanticRole === "informative" ? config.accessibleLabel ?? undefined : undefined}
      className="interaction-static-fallback"
      data-fallback-reason={reason}
      data-testid={config.fallback.assetId === "axora-buddy-v1" ? "axora-buddy" : "trusted-interaction-fallback"}
      role={config.semanticRole === "informative" ? "img" : undefined}
    >
      {config.fallback.assetId === "axora-buddy-v1" ? (
        <AxoraBuddy
          accessibleLabel={config.accessibleLabel}
          colorTreatment={config.colorTreatment}
          semanticRole={config.semanticRole}
          staticFallback
        />
      ) : (
        <svg aria-hidden="true" className="interaction-static-mark" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="20" fill="#102a43" />
          <path d="m16 43 16-28 16 28h-9l-7-13-7 13z" fill="#60a5fa" />
          <circle cx="32" cy="43" r="5" fill="#2dd4bf" />
        </svg>
      )}
      <span className="interaction-visually-hidden">Static illustration</span>
    </div>
  );
}

function AxoraOrbit({ config }: { config: ActiveInteractionConfig }) {
  return (
    <svg
      aria-hidden={config.semanticRole === "decorative" ? "true" : undefined}
      aria-label={config.semanticRole === "informative" ? config.accessibleLabel ?? undefined : undefined}
      className="axora-orbit-art"
      role={config.semanticRole === "informative" ? "img" : undefined}
      viewBox="0 0 120 120"
    >
      <circle cx="60" cy="60" r="21" fill="#102a43" />
      <circle cx="60" cy="60" r="38" fill="none" stroke="#60a5fa" strokeDasharray="5 8" strokeWidth="3" />
      <circle cx="60" cy="60" r="51" fill="none" opacity=".7" stroke="#2dd4bf" strokeWidth="2" />
      <circle className="axora-orbit-node axora-orbit-node-one" cx="98" cy="60" r="7" fill="#2563eb" />
      <circle className="axora-orbit-node axora-orbit-node-two" cx="60" cy="9" r="6" fill="#0f9d8a" />
      <path d="m51 68 9-18 9 18h-6l-3-7-3 7z" fill="#fff" />
    </svg>
  );
}

function RestrainedMotionArtwork({ config }: { config: ActiveInteractionConfig }) {
  return (
    <div
      aria-hidden={config.semanticRole === "decorative" ? "true" : undefined}
      aria-label={config.semanticRole === "informative" ? config.accessibleLabel ?? undefined : undefined}
      className="interaction-restrained-art"
      role={config.semanticRole === "informative" ? "img" : undefined}
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function TrustedAsset({ config }: { config: ActiveInteractionConfig }) {
  switch (config.assetId) {
    case "axora-buddy-v1":
      return (
        <AxoraBuddy
          accessibleLabel={config.accessibleLabel}
          colorTreatment={config.colorTreatment}
          semanticRole={config.semanticRole}
        />
      );
    case "axora-orbit-v1":
      return <AxoraOrbit config={config} />;
    case "axora-restrained-motion-v1":
      return <RestrainedMotionArtwork config={config} />;
    case "axora-mark-static-v1":
      return <StaticInteractionFallback config={config} reason="static-asset" />;
  }
}

class InteractionAssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function protectedRectsFor(boundary: HTMLElement): ProtectedRect[] {
  const surface = boundary.closest<HTMLElement>("[data-interaction-surface]") ?? boundary.parentElement;
  if (!surface) return [];
  const boundaryRect = boundary.getBoundingClientRect();

  return Array.from(surface.querySelectorAll<HTMLElement>("[data-protected-zone]"))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.protectedZone ?? `protected-${index}`,
        x: rect.left - boundaryRect.left,
        y: rect.top - boundaryRect.top,
        width: rect.width,
        height: rect.height,
      };
    });
}

function localPoint(event: { clientX: number; clientY: number }, boundary: HTMLElement): Point {
  const rect = boundary.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function TrustedInteractionRenderer({
  config: untrustedConfig,
  mode = "standard",
  paused: externallyPaused = false,
  className,
  onDismiss,
}: TrustedInteractionRendererProps) {
  const parsed = useMemo(() => InteractionConfigSchema.safeParse(untrustedConfig), [untrustedConfig]);
  const activeConfig = parsed.success && parsed.data.enabled ? parsed.data : null;
  const systemReducedMotion = useReducedMotion();
  const hasMounted = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  const mascotRef = useRef<HTMLDivElement | null>(null);
  const animationFrame = useRef<number | null>(null);
  const environmentRef = useRef<MascotEnvironment>({
    bounds: EMPTY_BOUNDS,
    sprite: { width: 86, height: 98 },
    protectedZones: [],
    dragEnabled: false,
    automaticMovement: false,
    reactionsEnabled: false,
    walkingSpeed: 0,
    idleFrequencyMs: 2_000,
    resumeDelayMs: 200,
    reducedMotion: false,
    documentVisible: true,
  });
  const initialMachine = useMemo(() => createInitialMascotMachine(), []);
  const machineRef = useRef<MascotMachine>(initialMachine);
  const [machine, setMachine] = useState<MascotMachine>(initialMachine);
  const [offscreen, setOffscreen] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [viewportBehavior, setViewportBehavior] = useState<ActiveInteractionConfig["desktopBehavior"]>("full");
  const externalPauseSent = useRef(false);
  const positionedAsset = useRef<string | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const applyEffects = useCallback((effects: readonly MascotEffect[]) => {
    for (const effect of effects) {
      if (effect.type === "capture-pointer") {
        try {
          mascotRef.current?.setPointerCapture(effect.pointerId);
        } catch {
          // The pointer may already have been cancelled by the browser.
        }
      }
      if (effect.type === "release-pointer") {
        try {
          if (mascotRef.current?.hasPointerCapture(effect.pointerId)) {
            mascotRef.current.releasePointerCapture(effect.pointerId);
          }
        } catch {
          // Pointer capture is best-effort during route changes and unmounting.
        }
      }
    }
  }, []);

  const send = useCallback((event: MascotEvent) => {
    const transition = transitionMascot(machineRef.current, event, environmentRef.current);
    machineRef.current = transition.machine;
    setMachine(transition.machine);
    applyEffects(transition.effects);
    return transition;
  }, [applyEffects]);

  const reducedByPolicy = Boolean(
    (hasMounted && systemReducedMotion)
    || mode === "reduced-motion"
    || mode === "low-performance"
    || viewportBehavior === "reduced"
    || viewportBehavior === "static",
  );
  const hiddenByDevice = viewportBehavior === "hidden";
  const visibleEnvironment = Boolean(activeConfig && !documentHidden && !offscreen && !hiddenByDevice);
  const spriteScale = activeConfig ? Math.min(1.5, Math.max(0.5, activeConfig.scale)) : 1;
  const sprite = useMemo(() => ({ width: 86 * spriteScale, height: 98 * spriteScale }), [spriteScale]);

  useEffect(() => {
    if (!activeConfig) return;
    const updateViewport = () => setViewportBehavior(behaviorForViewport(activeConfig));
    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });
    return () => window.removeEventListener("resize", updateViewport);
  }, [activeConfig]);

  useEffect(() => {
    const handleVisibility = () => setDocumentHidden(document.hidden);
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry?.isIntersecting), { threshold: 0.05 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    environmentRef.current = {
      ...environmentRef.current,
      sprite,
      dragEnabled: Boolean(activeConfig?.dragEnabled && activeConfig.approvedStates.includes("grabbed")),
      automaticMovement: Boolean(activeConfig?.automaticMovement && activeConfig.approvedStates.includes("walking-left")),
      reactionsEnabled: Boolean(activeConfig?.reactionsEnabled && activeConfig.approvedStates.includes("reacting")),
      walkingSpeed: activeConfig?.walkingSpeed ?? 0,
      idleFrequencyMs: (activeConfig?.idleFrequencySeconds ?? 2) * 1_000,
      resumeDelayMs: activeConfig?.resumeDelayMs ?? 200,
      reducedMotion: reducedByPolicy,
      documentVisible: visibleEnvironment,
    };
  }, [activeConfig, reducedByPolicy, sprite, visibleEnvironment]);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary || !activeConfig) return;

    const updateBounds = () => {
      const bounds = {
        minX: 14,
        maxX: Math.max(14, boundary.clientWidth - sprite.width - 14),
        minY: 12,
        maxY: Math.max(12, boundary.clientHeight - sprite.height - 12),
      };
      environmentRef.current = {
        ...environmentRef.current,
        bounds,
        protectedZones: protectedRectsFor(boundary),
      };

      if (positionedAsset.current !== activeConfig.assetId) {
        const next = createInitialMascotMachine({
          position: {
            x: bounds.minX + (bounds.maxX - bounds.minX) * placementFraction(activeConfig.initialPlacement),
            y: bounds.maxY,
          },
          facing: activeConfig.initialPlacement.endsWith("left") ? "right" : "left",
          reducedMotion: reducedByPolicy,
          visible: visibleEnvironment,
        });
        positionedAsset.current = activeConfig.assetId;
        machineRef.current = next;
        setMachine(next);
      } else {
        send({ type: "resize" });
      }
    };

    updateBounds();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateBounds);
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [activeConfig, reducedByPolicy, send, sprite, visibleEnvironment]);

  useEffect(() => {
    if (!activeConfig) return;
    if (machineRef.current.state === "loading") send({ type: "asset-loaded" });
  }, [activeConfig, machine.sequence, send]);

  useEffect(() => {
    if (!activeConfig) return;
    send({ type: "reduced-motion-change", reduced: reducedByPolicy });
  }, [activeConfig, reducedByPolicy, send]);

  useEffect(() => {
    if (!activeConfig || machineRef.current.pauseReason === "manual") return;
    send({ type: "visibility-change", visible: visibleEnvironment });
  }, [activeConfig, send, visibleEnvironment]);

  useEffect(() => {
    if (!activeConfig) return;
    if (externallyPaused && !externalPauseSent.current) {
      externalPauseSent.current = true;
      send({ type: "pause", reason: "manual" });
    } else if (!externallyPaused && externalPauseSent.current) {
      externalPauseSent.current = false;
      send({ type: "resume" });
    }
  }, [activeConfig, externallyPaused, send]);

  useEffect(() => {
    x.set(machine.position.x);
    y.set(machine.position.y);
  }, [machine.position.x, machine.position.y, x, y]);

  useEffect(() => {
    if (!activeConfig || reducedByPolicy || !visibleEnvironment || machine.state === "paused" || machine.state === "hidden") return;
    let previous = performance.now();
    const tick = (now: number) => {
      send({ type: "tick", deltaMs: Math.max(0, now - previous) });
      previous = now;
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    };
  }, [activeConfig, machine.state, reducedByPolicy, send, visibleEnvironment]);

  useEffect(() => () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    const transition = transitionMascot(machineRef.current, { type: "unmount" }, environmentRef.current);
    machineRef.current = transition.machine;
    applyEffects(transition.effects);
  }, [applyEffects]);

  const pointForEvent = useCallback((event: { clientX: number; clientY: number }) => {
    const boundary = boundaryRef.current;
    return boundary ? localPoint(event, boundary) : machineRef.current.position;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    send({ type: "pointer-down", pointerId: event.pointerId, point: pointForEvent(event) });
  }, [pointForEvent, send]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (machineRef.current.activePointerId !== event.pointerId) return;
    send({ type: "pointer-move", pointerId: event.pointerId, point: pointForEvent(event) });
  }, [pointForEvent, send]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (machineRef.current.activePointerId !== event.pointerId) return;
    send({ type: "pointer-up", pointerId: event.pointerId, point: pointForEvent(event) });
  }, [pointForEvent, send]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (machineRef.current.activePointerId !== event.pointerId) return;
    send({ type: "pointer-cancel", pointerId: event.pointerId });
  }, [send]);

  const visitorPaused = machine.state === "paused" && machine.pauseReason === "manual";
  const assetFailed = machine.state === "error-fallback";
  const disabled = parsed.success && !parsed.data.enabled;
  const invalid = !parsed.success;
  const hiddenForReducedMotion = reducedByPolicy && activeConfig?.reducedMotionBehavior === "hidden";
  const dismissed = machine.state === "hidden" && machine.pauseReason === "manual";
  const renderStatic = Boolean(activeConfig && (reducedByPolicy || assetFailed));
  const renderHidden = disabled || hiddenByDevice || hiddenForReducedMotion || dismissed || machine.state === "unmounted";
  const dataState = invalid
    ? "error-fallback"
    : renderHidden
      ? "hidden"
      : renderStatic
        ? assetFailed ? "error-fallback" : "reduced-motion"
        : machine.state;
  const fallbackReason = invalid
    ? "invalid-config"
    : disabled
      ? "disabled"
      : assetFailed
        ? "asset-error"
        : mode === "low-performance"
          ? "low-performance"
          : (hasMounted && systemReducedMotion) || mode === "reduced-motion"
            ? "reduced-motion"
            : viewportBehavior === "static"
              ? "device-static"
              : "none";
  const dataPaused = machine.state === "paused" || machine.pauseReason === "offscreen" || externallyPaused;

  const handlePauseToggle = () => {
    send({ type: visitorPaused ? "resume" : "pause", ...(visitorPaused ? {} : { reason: "manual" as const }) });
  };

  const handleDismiss = () => {
    send({ type: "dismiss" });
    onDismiss?.();
  };

  return (
    <div
      aria-live="off"
      className={["trusted-interaction", className].filter(Boolean).join(" ")}
      data-direction={machine.facing}
      data-fallback={fallbackReason}
      data-paused={dataPaused ? "true" : "false"}
      data-state={dataState}
      data-testid="trusted-interaction"
      ref={rootRef}
    >
      {invalid ? <InvalidStaticFallback /> : null}
      {activeConfig && !renderHidden ? (
        <div className={`interaction-boundary interaction-region-${activeConfig.permittedRegion}`} ref={boundaryRef}>
          {renderStatic ? (
            <StaticInteractionFallback config={activeConfig} reason={fallbackReason} />
          ) : (
            <motion.div
              animate={{
                rotate: machine.state === "being-carried" ? (machine.facing === "left" ? -4 : 4) : 0,
                scale: machine.state === "grabbed" || machine.state === "being-carried"
                  ? 1.06
                  : machine.state === "landing"
                    ? 0.94
                    : 1,
              }}
              className="interaction-mascot-position"
              data-testid={activeConfig.assetId === "axora-buddy-v1" ? "axora-buddy" : "trusted-interaction-asset"}
              drag={activeConfig.dragEnabled
                && activeConfig.approvedStates.includes("grabbed")
                && !dataPaused
                && !reducedByPolicy}
              dragConstraints={boundaryRef}
              dragElastic={0.04}
              dragMomentum={false}
              onClick={() => send({ type: "react" })}
              onLostPointerCapture={handlePointerCancel}
              onPointerCancel={handlePointerCancel}
              onPointerDown={handlePointerDown}
              onPointerEnter={() => send({ type: "pointer-enter" })}
              onPointerLeave={() => send({ type: "pointer-leave" })}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              ref={mascotRef}
              style={{ width: sprite.width, x, y }}
              transition={{ type: "spring", stiffness: 360, damping: 24, mass: 0.7 }}
              whileDrag={{ scale: 1.08 }}
            >
              <div className="interaction-mascot-facing" data-facing={machine.facing}>
                <InteractionAssetBoundary
                  fallback={<StaticInteractionFallback config={activeConfig} reason="asset-error" />}
                  key={activeConfig.assetId}
                  onError={() => send({ type: "asset-error" })}
                >
                  <TrustedAsset config={activeConfig} />
                </InteractionAssetBoundary>
              </div>
            </motion.div>
          )}

          {activeConfig.allowVisitorPause || activeConfig.allowVisitorDismiss ? (
            <div className="interaction-visitor-controls" aria-label="Animation controls" role="group">
              {activeConfig.allowVisitorPause ? (
                <button
                  aria-label={visitorPaused ? "Resume interactive experience" : "Pause interactive experience"}
                  data-ux-silent="true"
                  onClick={handlePauseToggle}
                  type="button"
                >
                  {visitorPaused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
                </button>
              ) : null}
              {activeConfig.allowVisitorDismiss ? (
                <button aria-label="Dismiss interactive experience" data-ux-silent="true" onClick={handleDismiss} type="button">
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
