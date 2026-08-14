"use client";

import Image from "next/image";
import Link from "next/link";
import { type ComponentType, useEffect, useState } from "react";
import styles from "./ImmersiveWorld.module.css";

type EmblemCanvasProps = { activation: number; onReady: () => void };

export function AxoraBrandEmblem({ href, label, className }: { href: string; label: string; className?: string }) {
  const [activation, setActivation] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const [EmblemCanvas, setEmblemCanvas] = useState<ComponentType<EmblemCanvasProps> | null>(null);
  useEffect(() => {
    let active = true;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = matchMedia("(pointer: coarse)");
    const probe = document.createElement("canvas");
    const webgl = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    const frame = window.requestAnimationFrame(() => {
      if (!webgl || reduced.matches || coarse.matches || !navigator.onLine) return;
      void import("./AxoraBrandEmblemCanvas")
        .then((module) => {
          if (active) setEmblemCanvas(() => module.default);
        })
        .catch(() => {
          if (active) {
            setCanvasReady(false);
            setEmblemCanvas(null);
          }
        });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, []);
  const activate = () => setActivation((value) => value + 1);
  return (
    <Link className={`${styles.brandEmblem}${className ? ` ${className}` : ""}`} href={href} aria-label={label}
      onPointerEnter={activate} onFocus={activate} onClick={activate}
      data-canvas-ready={canvasReady || undefined}>
      <span className={styles.brandEmblemDepth} aria-hidden="true" />
      <Image src="/brand/axora-logo.png" width={158} height={29} alt="" priority />
      {EmblemCanvas ? <EmblemCanvas activation={activation} onReady={() => setCanvasReady(true)} /> : null}
    </Link>
  );
}
