"use client";

import { ArrowDown, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupportedLocale } from "@/lib/i18n";
import {
  PUBLIC_SCENE_MODELS,
  immersivePublicCopy,
  type PublicSceneRoute,
  type PublicAtmosphereId,
} from "@/lib/immersive-public-experience";
import { ImmersiveAudioController, type ImmersiveSoundId } from "@/lib/immersive-audio";
import { publicSceneStates } from "@/lib/public-scene-states";
import type { ImmersiveSceneRuntime } from "@/lib/immersive-scene-runtime";
import { AtmosphereSelector } from "./AtmosphereSelector";
import { useAtmosphere } from "./AtmosphereProvider";
import { AxoraSemanticScene } from "./AxoraSemanticScene";
import styles from "./ImmersiveWorld.module.css";

const SOUND_STORAGE_KEY = "axora-interface-sound:v2";

function useStageAudio() {
  const controllerRef = useRef<ImmersiveAudioController | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const controller = new ImmersiveAudioController((path) => new Audio(path));
    controllerRef.current = controller;
    let enabledPreference = false;
    try {
      enabledPreference = window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
    } catch {
      // Sound remains muted.
    }
    controller.setEnabled(enabledPreference);
    const frame = window.requestAnimationFrame(() => setEnabled(enabledPreference));
    const unlockSavedPreference = () => {
      if (enabledPreference) controller.unlock();
    };
    window.addEventListener("pointerdown", unlockSavedPreference, { once: true });
    window.addEventListener("keydown", unlockSavedPreference, { once: true });
    window.addEventListener("wheel", unlockSavedPreference, { once: true, passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", unlockSavedPreference);
      window.removeEventListener("keydown", unlockSavedPreference);
      window.removeEventListener("wheel", unlockSavedPreference);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [stop]);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // The current-page preference still works.
      }
      controllerRef.current?.setEnabled(next);
      if (next) controllerRef.current?.unlock();
      return next;
    });
  }, []);

  const play = useCallback((stage: ImmersiveSoundId) => controllerRef.current?.play(stage) ?? false, []);

  return useMemo(() => ({ enabled, toggle, play, stop }), [enabled, play, stop, toggle]);
}

export function AxoraImmersiveExperience({
  locale,
  route = "home",
  challenge,
}: {
  locale: SupportedLocale;
  route?: PublicSceneRoute;
  challenge?: ReactNode;
}) {
  const copy = immersivePublicCopy(locale);
  const { atmosphere } = useAtmosphere();
  const atmosphereId = atmosphere.toLowerCase() as PublicAtmosphereId;
  const sound = useStageAudio();
  const routeModels = PUBLIC_SCENE_MODELS[route];
  const sceneStates = useMemo(() => publicSceneStates(route, locale), [locale, route]);
  const [requestedIndex, setRequestedIndex] = useState(0);
  const [renderedIndex, setRenderedIndex] = useState(0);
  const [scenePhase, setScenePhase] = useState<ImmersiveSceneRuntime["phase"]>("loading");
  const [sceneEngaged, setSceneEngaged] = useState(false);
  const [interactionReady, setInteractionReady] = useState(false);
  const activeModel = routeModels[requestedIndex] ?? routeModels[0];
  const nextModel = routeModels[(requestedIndex + 1) % routeModels.length];
  const routeText = route === "home" ? null : copy.routeCopy[route];
  const rootRef = useRef<HTMLDivElement>(null);
  const requestedIndexRef = useRef(0);
  const renderedIndexRef = useRef(0);
  const transitionRequested = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInteractionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const activate = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(routeModels.length - 1, index));
    setSceneEngaged(true);
    if (bounded === requestedIndexRef.current) return;
    transitionRequested.current = true;
    requestedIndexRef.current = bounded;
    sound.stop();
    setRequestedIndex(bounded);
    setScenePhase("loading");
  }, [routeModels.length, sound]);

  const handleSceneRuntime = useCallback((runtime: ImmersiveSceneRuntime) => {
    const expected = routeModels[requestedIndexRef.current];
    if (runtime.requestedAsset !== expected) return;
    if (renderedIndexRef.current === requestedIndexRef.current
      && runtime.renderedAsset === expected
      && runtime.phase !== "ready"
      && runtime.phase !== "fallback") return;
    setScenePhase(runtime.phase);
    if ((runtime.phase !== "ready" && runtime.phase !== "fallback")
      || runtime.renderedAsset !== expected) return;
    const nextIndex = requestedIndexRef.current;
    if (renderedIndexRef.current === nextIndex) return;
    renderedIndexRef.current = nextIndex;
    setRenderedIndex(nextIndex);
    if (transitionRequested.current) {
      sound.play(sceneStates[nextIndex]?.sound ?? expected);
      transitionRequested.current = false;
    }
  }, [routeModels, sceneStates, sound]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = [...root.querySelectorAll<HTMLElement>("[data-scene-step]")];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = Number((visible.target as HTMLElement).dataset.sceneStep);
      if (Number.isInteger(index)) activate(index);
    }, { rootMargin: "-30% 0px -48%", threshold: [0.2, 0.55, 0.8] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [activate]);

  useEffect(() => {
    if (route !== "home") return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < routeModels.length) activate(index);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [activate, route, routeModels.length]);

  const sceneDescription = sceneStates[renderedIndex]?.description ?? copy.sceneAlternative;
  const heading = routeText?.title ?? copy.title;
  const lead = routeText?.lead ?? copy.lead;
  const eyebrow = routeText?.eyebrow ?? copy.eyebrow;
  const controlItems = sceneStates;
  const requestedLabel = controlItems[requestedIndex]?.label ?? "";
  const loadingLabel = locale === "ar"
    ? `جارٍ تحميل ${requestedLabel}`
    : locale === "ms" ? `Memuatkan ${requestedLabel}` : `Loading ${requestedLabel}`;

  return (
    <div
      className={styles.world}
      data-atmosphere={atmosphereId}
      data-interaction-ready={interactionReady}
      data-locale={locale}
      data-public-scene={route}
      data-requested-stage={routeModels[requestedIndex]}
      data-rendered-stage={routeModels[renderedIndex]}
      data-scene-phase={scenePhase}
      dir={locale === "ar" ? "rtl" : "ltr"}
      ref={rootRef}
    >
      <div className={styles.scrollProgress} aria-hidden="true" />
      <section className={styles.hero} aria-labelledby={`immersive-${route}-title`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 id={`immersive-${route}-title`}>{heading}</h1>
          <p className={styles.lead}>{lead}</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryAction} href="#workflow">
              {copy.explore}<ArrowDown aria-hidden="true" />
            </a>
            <Link className={styles.secondaryAction} href="/login">
              {locale === "ar" ? "تسجيل الدخول" : locale === "ms" ? "Log masuk" : "Sign in"}<ArrowRight className="directional-icon" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className={styles.heroWorld}>
          <AxoraSemanticScene
            model={activeModel}
            nextModel={nextModel}
            atmosphere={atmosphereId}
            alternative={copy.sceneAlternative}
            route={route}
            direction={locale === "ar" ? "rtl" : "ltr"}
            engaged={sceneEngaged}
            loadingLabel={loadingLabel}
            onRuntimeChange={handleSceneRuntime}
          />
          <div className={styles.sceneCaption} data-testid="scene-caption" aria-live="polite">
            <span>{String(renderedIndex + 1).padStart(2, "0")}</span>
            <strong>{controlItems[renderedIndex]?.label}</strong>
            <p>{sceneDescription}</p>
          </div>
        </div>
        <AtmosphereSelector
          locale={locale}
          onThemeSelect={() => sound.play("theme")}
          showThemes={false}
          soundEnabled={sound.enabled}
          onSoundToggle={sound.toggle}
        />
      </section>

      {challenge}

      <section className={styles.workflow} id="workflow" data-testid="workflow-console" aria-label={copy.consoleLabel}>
        <div className={styles.stickyScene}>
          <AxoraSemanticScene
            model={activeModel}
            nextModel={nextModel}
            atmosphere={atmosphereId}
            alternative={copy.sceneAlternative}
            route={`${route}-workflow`}
            direction={locale === "ar" ? "rtl" : "ltr"}
            engaged={sceneEngaged}
            loadingLabel={loadingLabel}
            onRuntimeChange={handleSceneRuntime}
          />
        </div>
        <div className={styles.workflowSteps} role="list" aria-label={copy.consoleLabel}>
          {controlItems.map((item, index) => (
            <article
              role="listitem"
              key={`${item.model}-${index}`}
              data-scene-step={index}
              className={styles.workflowStep}
              data-active={renderedIndex === index}
              data-requested={requestedIndex === index}
              data-rendered={renderedIndex === index}
            >
              <button
                type="button"
                aria-pressed={renderedIndex === index}
                aria-label={`${String(index + 1).padStart(2, "0")} · ${item.label}`}
                onClick={() => activate(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.title}</small>
              </button>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      {route === "home" ? (
        <>
          <section className={styles.storyGrid} aria-labelledby="how-axora-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>{copy.sections.howTitle}</p>
              <h2 id="how-axora-title">{copy.sections.deliveryTitle}</h2>
              <p>{copy.sections.deliveryBody}</p>
            </div>
            {copy.sections.howItems.map((item, index) => (
              <article key={item}><span>0{index + 1}</span><h3>{item}</h3><CheckCircle2 aria-hidden="true" /></article>
            ))}
          </section>
          <section className={styles.securityBand}>
            <ShieldCheck aria-hidden="true" />
            <div><h2>{copy.sections.securityTitle}</h2><p>{copy.sections.securityBody}</p></div>
          </section>
          <section className={styles.cta}>
            <p className={styles.eyebrow}>Axora</p>
            <h2>{copy.sections.ctaTitle}</h2>
            <p>{copy.sections.ctaBody}</p>
            <Link className={styles.primaryAction} href={`/${locale}/contact`}>{locale === "ar" ? "تواصل معنا" : locale === "ms" ? "Hubungi kami" : "Contact Axora"}</Link>
          </section>
        </>
      ) : (
        <section className={styles.routeSummary}>
          {routeText?.steps.map((step, index) => <article key={step}><span>0{index + 1}</span><h2>{step}</h2><p>{sceneStates[index]?.description}</p></article>)}
        </section>
      )}
    </div>
  );
}

export const immersiveSoundStorageKey = SOUND_STORAGE_KEY;
