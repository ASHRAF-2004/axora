"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicAtmosphereId, SemanticModelId } from "@/lib/immersive-public-experience";
import styles from "./ImmersiveWorld.module.css";

const SceneCanvas = dynamic(() => import("./AxoraSemanticSceneCanvas"), {
  ssr: false,
  loading: () => <div className={styles.sceneLoading} role="status" aria-label="Loading interactive workflow" />,
});

class SceneErrorBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
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
}: {
  model: SemanticModelId;
  nextModel?: SemanticModelId;
  atmosphere: PublicAtmosphereId;
  alternative: string;
  route: string;
  direction: "ltr" | "rtl";
}) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  const [fallbackReason, setFallbackReason] = useState<string | null>("checking");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const frame = window.requestAnimationFrame(() => {
      setReducedMotion(motion.matches);
      setFallbackReason(motion.matches ? "reduced-motion" : reducedData ? "reduced-data" : supportsWebGL() ? null : "webgl-unavailable");
    });
    const onMotion = () => {
      setReducedMotion(motion.matches);
      if (motion.matches) setFallbackReason("reduced-motion");
      else if (!reducedData) setFallbackReason(supportsWebGL() ? null : "webgl-unavailable");
    };
    motion.addEventListener("change", onMotion);
    return () => {
      window.cancelAnimationFrame(frame);
      motion.removeEventListener("change", onMotion);
    };
  }, []);

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

  return (
    <div className={styles.scene} ref={container} data-scene-route={route} data-semantic-model={model}>
      {fallbackReason ? (
        <SceneFallback alternative={alternative} model={model} reason={fallbackReason} />
      ) : (
        <SceneErrorBoundary fallback={<SceneFallback alternative={alternative} model={model} reason="scene-failed" />}>
          <SceneCanvas
            model={model}
            nextModel={nextModel}
            atmosphere={atmosphere}
            reducedMotion={reducedMotion}
            active={active}
            onContextLost={() => setFallbackReason("context-lost")}
            direction={direction}
          />
        </SceneErrorBoundary>
      )}
    </div>
  );
}
