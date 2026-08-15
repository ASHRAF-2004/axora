"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicAtmosphereId, SemanticModelId } from "@/lib/immersive-public-experience";
import type { ImmersiveSceneRuntime } from "@/lib/immersive-scene-runtime";
import styles from "./ImmersiveWorld.module.css";

const SceneCanvas = dynamic(() => import("./AxoraSemanticSceneCanvas"), {
  ssr: false,
  loading: () => <div className={styles.sceneLoading} aria-hidden="true" />,
});

class SceneErrorBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
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

function SceneFallback({
  alternative,
  model,
  reason,
}: {
  alternative: string;
  model: SemanticModelId;
  reason: string;
}) {
  return <div className={styles.sceneFallback} data-testid="workflow-fallback" data-reason={reason}>
    <span className={styles.fallbackObject} data-model={model} aria-hidden="true" />
    <p>{alternative}</p>
  </div>;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function AxoraSemanticScene({
  model,
  nextModel,
  atmosphere,
  alternative,
  route,
  direction,
  engaged,
  loadingLabel,
  onRuntimeChange,
}: {
  model: SemanticModelId;
  nextModel?: SemanticModelId;
  atmosphere: PublicAtmosphereId;
  alternative: string;
  route: string;
  direction: "ltr" | "rtl";
  engaged: boolean;
  loadingLabel: string;
  onRuntimeChange?: (runtime: ImmersiveSceneRuntime) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const contextLost = useRef(false);
  const [active, setActive] = useState(true);
  const [fallbackReason, setFallbackReason] = useState<string | null>("checking");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [runtime, setRuntime] = useState<ImmersiveSceneRuntime>({
    phase: "loading",
    requestedAsset: model,
    attachedAsset: null,
    renderedAsset: null,
    transitionFrom: null,
    bounds: null,
    insideFrustum: false,
  });

  const reportRuntime = useCallback((next: ImmersiveSceneRuntime) => {
    setRuntime(next);
    onRuntimeChange?.(next);
  }, [onRuntimeChange]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 760px)");
    const reducedData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const resolveFallback = () => {
      setReducedMotion(motion.matches);
      if (contextLost.current) {
        setFallbackReason("context-lost");
        return;
      }
      setFallbackReason(
        motion.matches
          ? "reduced-motion"
          : reducedData
            ? "reduced-data"
            : compact.matches && !engaged
              ? "mobile-deferred"
              : supportsWebGL()
                ? null
                : "webgl-unavailable",
      );
    };
    const frame = window.requestAnimationFrame(() => {
      resolveFallback();
    });
    motion.addEventListener("change", resolveFallback);
    compact.addEventListener("change", resolveFallback);
    return () => {
      window.cancelAnimationFrame(frame);
      motion.removeEventListener("change", resolveFallback);
      compact.removeEventListener("change", resolveFallback);
    };
  }, [engaged]);

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting && document.visibilityState === "visible"), { rootMargin: "160px" });
    const visibility = () => setActive(document.visibilityState === "visible" && target.getBoundingClientRect().bottom > -160 && target.getBoundingClientRect().top < innerHeight + 160);
    observer.observe(target);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!fallbackReason || fallbackReason === "checking") return;
    const frame = window.requestAnimationFrame(() => {
      reportRuntime({
        phase: "fallback",
        requestedAsset: model,
        attachedAsset: model,
        renderedAsset: model,
        transitionFrom: null,
        bounds: null,
        insideFrustum: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fallbackReason, model, reportRuntime]);

  return (
    <div
      className={styles.scene}
      ref={container}
      data-scene-route={route}
      data-semantic-model={runtime.renderedAsset ?? model}
      data-scene-status={runtime.phase}
      data-requested-asset={runtime.requestedAsset}
      data-rendered-asset={runtime.renderedAsset ?? undefined}
    >
      {fallbackReason ? (
        <SceneFallback alternative={alternative} model={model} reason={fallbackReason} />
      ) : (
        <SceneErrorBoundary
          fallback={<SceneFallback alternative={alternative} model={model} reason="scene-failed" />}
          onError={() => setFallbackReason("scene-failed")}
        >
          <SceneCanvas
            model={model}
            nextModel={nextModel}
            atmosphere={atmosphere}
            reducedMotion={reducedMotion}
            active={active}
            onContextLost={() => {
              contextLost.current = true;
              setFallbackReason("context-lost");
            }}
            direction={direction}
            onRuntimeChange={reportRuntime}
          />
        </SceneErrorBoundary>
      )}
      {runtime.phase === "loading" && !fallbackReason ? <div className={styles.sceneRuntimeStatus} role="status">{loadingLabel}…</div> : null}
    </div>
  );
}
