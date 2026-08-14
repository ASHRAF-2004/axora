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
  STAGE_SOUND_PATHS,
  immersivePublicCopy,
  type PublicSceneRoute,
  type PublicAtmosphereId,
  type SemanticModelId,
} from "@/lib/immersive-public-experience";
import { AtmosphereSelector } from "./AtmosphereSelector";
import { useAtmosphere } from "./AtmosphereProvider";
import { AxoraSemanticScene } from "./AxoraSemanticScene";
import styles from "./ImmersiveWorld.module.css";

const SOUND_STORAGE_KEY = "axora-interface-sound:v2";

function routeModelLabel(model: SemanticModelId, index: number, locale: SupportedLocale) {
  const labels: Record<SupportedLocale, Partial<Record<SemanticModelId, string>>> = {
    en: { person: "Role", workspace: "Workspace", company: "Company", shield: "Shield", vault: "Vault", network: "Network", flag: "Shared future" },
    ar: { person: "الدور", workspace: "مساحة العمل", company: "الشركة", shield: "الدرع", vault: "الخزنة", network: "الشبكة", flag: "المستقبل المشترك" },
    ms: { person: "Peranan", workspace: "Ruang kerja", company: "Syarikat", shield: "Perisai", vault: "Bilik kebal", network: "Rangkaian", flag: "Masa depan bersama" },
  };
  return labels[locale][model] ?? `${index + 1}`;
}

function useStageAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doorRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let enabledPreference = false;
    try {
      enabledPreference = window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
    } catch {
      // Sound remains muted.
    }
    const frame = window.requestAnimationFrame(() => setEnabled(enabledPreference));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const audio of [audioRef.current, doorRef.current]) {
      if (!audio) continue;
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      stop();
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
      if (!next) stop();
      return next;
    });
  }, [stop]);

  const play = useCallback((stage: SemanticModelId | "theme") => {
    if (!enabled) return;
    stop();
    const audio = new Audio(STAGE_SOUND_PATHS[stage]);
    audio.volume = stage === "deliver" ? 0.22 : 0.3;
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
    if (stage === "deliver") {
      timerRef.current = window.setTimeout(() => {
        const door = new Audio("/immersive/sounds/delivery-door.wav");
        door.volume = 0.22;
        doorRef.current = door;
        void door.play().catch(() => undefined);
      }, 720);
    }
  }, [enabled, stop]);

  return { enabled, toggle, play };
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [interactionReady, setInteractionReady] = useState(false);
  const activeModel = routeModels[activeIndex] ?? routeModels[0];
  const nextModel = routeModels[(activeIndex + 1) % routeModels.length];
  const homeStage = route === "home" ? copy.stages[activeIndex] : null;
  const routeText = route === "home" ? null : copy.routeCopy[route];
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInteractionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const activate = useCallback((index: number, announce = true) => {
    const bounded = Math.max(0, Math.min(routeModels.length - 1, index));
    setActiveIndex(bounded);
    const model = routeModels[bounded];
    if (announce) sound.play(model);
  }, [routeModels, sound]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = [...root.querySelectorAll<HTMLElement>("[data-scene-step]")];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = Number((visible.target as HTMLElement).dataset.sceneStep);
      if (Number.isInteger(index)) activate(index, false);
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

  const sceneDescription = homeStage?.description ?? routeText?.steps[activeIndex % routeText.steps.length] ?? copy.sceneAlternative;
  const heading = routeText?.title ?? copy.title;
  const lead = routeText?.lead ?? copy.lead;
  const eyebrow = routeText?.eyebrow ?? copy.eyebrow;
  const controlItems = useMemo(() => route === "home"
    ? copy.stages.map((stage) => ({ label: stage.label, title: stage.title, model: stage.id as SemanticModelId }))
    : routeModels.map((model, index) => ({ label: routeModelLabel(model, index, locale), title: routeText?.steps[index % (routeText?.steps.length ?? 1)] ?? "", model })), [copy.stages, locale, route, routeModels, routeText]);

  return (
    <div
      className={styles.world}
      data-atmosphere={atmosphereId}
      data-interaction-ready={interactionReady}
      data-locale={locale}
      data-public-scene={route}
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
          />
          <div className={styles.sceneCaption} aria-live="polite">
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <strong>{controlItems[activeIndex]?.label}</strong>
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
          />
        </div>
        <div className={styles.workflowSteps} role="list" aria-label={copy.consoleLabel}>
          {controlItems.map((item, index) => (
            <article role="listitem" key={`${item.model}-${index}`} data-scene-step={index} className={styles.workflowStep} data-active={activeIndex === index}>
              <button
                type="button"
                aria-pressed={activeIndex === index}
                aria-label={`${String(index + 1).padStart(2, "0")} · ${item.label}`}
                onClick={() => activate(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.title}</small>
              </button>
              {route === "home" ? <p>{copy.stages[index].description}</p> : null}
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
          {routeText?.steps.map((step, index) => <article key={step}><span>0{index + 1}</span><h2>{step}</h2><p>{sceneDescription}</p></article>)}
        </section>
      )}
    </div>
  );
}

export const immersiveSoundStorageKey = SOUND_STORAGE_KEY;
