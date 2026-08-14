"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./ImmersiveWorld.module.css";

const EmblemCanvas = dynamic(() => import("./AxoraBrandEmblemCanvas"), { ssr: false });

export function AxoraBrandEmblem({ href, label }: { href: string; label: string }) {
  const [activation, setActivation] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const [enhance, setEnhance] = useState(false);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = matchMedia("(pointer: coarse)");
    const probe = document.createElement("canvas");
    const webgl = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    const frame = window.requestAnimationFrame(() => {
      setEnhance(webgl && !reduced.matches && !coarse.matches);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const activate = () => setActivation((value) => value + 1);
  return (
    <Link className={styles.brandEmblem} href={href} aria-label={label}
      onPointerEnter={activate} onFocus={activate} onClick={activate}
      data-canvas-ready={canvasReady || undefined}>
      <span className={styles.brandEmblemDepth} aria-hidden="true" />
      <Image src="/brand/axora-logo.png" width={158} height={29} alt="" priority />
      {enhance ? <EmblemCanvas activation={activation} onReady={() => setCanvasReady(true)} /> : null}
    </Link>
  );
}
