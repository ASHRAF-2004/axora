"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  Headphones,
  MapPin,
  PackageCheck,
  Palette,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Component,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupportedLocale } from "@/lib/i18n";
import {
  PUBLIC_ATMOSPHERES,
  type ImmersivePublicCopy,
  type PublicAtmosphereId,
} from "@/lib/immersive-public-experience";
import styles from "./AxoraImmersiveExperience.module.css";

const WorkflowScene = dynamic(
  () => import("./AxoraWorkflowSceneCanvas").then((module) => module.AxoraWorkflowSceneCanvas),
  { ssr: false },
);

const stageIcons = [ClipboardList, BadgeCheck, CreditCard, FileText, ShoppingBag, Truck, MapPin, CheckCircle2];
const benefitIcons = [Building2, PackageCheck, ReceiptText];
const roleIcons = [Users, Headphones, Truck];
const THEME_STORAGE_KEY = "axora-public-atmosphere-v1";
const SOUND_STORAGE_KEY = "axora-public-sound-v1";

interface HeroCopy {
  eyebrow: string;
  title: string;
  lead: string;
  primaryAction: string;
  secondaryAction: string;
  trustNote: string;
}

interface Props {
  locale: SupportedLocale;
  prefix: string;
  hero: HeroCopy;
  copy: ImmersivePublicCopy;
  challenge: ReactNode;
}

type RenderMode = "pending" | "webgl" | "static" | "lost" | "failed";

class SceneBoundary extends Component<{
  children: ReactNode;
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
    return this.state.failed ? null : this.props.children;
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function constrainedDevice() {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return Boolean(
    navigatorWithHints.connection?.saveData
    || (navigatorWithHints.deviceMemory && navigatorWithHints.deviceMemory <= 2)
    || navigator.hardwareConcurrency <= 2,
  );
}

function StaticConsole({ activeIndex }: { activeIndex: number }) {
  return (
    <div className={styles.staticConsole} data-testid="workflow-static">
      <div className={styles.staticConsoleRoute} aria-hidden="true" />
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} data-active={index === activeIndex} aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
      ))}
      <div className={styles.staticPackage} aria-hidden="true" />
    </div>
  );
}

function PortalPreview({ copy }: { copy: ImmersivePublicCopy }) {
  return (
    <div className={styles.portalPreview} aria-label={copy.sections.portalPreview}>
      <div className={styles.portalTopbar}>
        <div className={styles.portalMark}>A</div>
        <div className={styles.portalNav}>
          {copy.sections.portalNavigation.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <div className={styles.portalCanvas}>
        <div className={styles.portalGreeting}>
          <span />
          <strong>{copy.sections.portalPreview}</strong>
          <i />
        </div>
        <div className={styles.portalTiles}><i /><i /><i /></div>
      </div>
      <div className={styles.portalSwatches} aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
  );
}

export function AxoraImmersiveExperience({ locale, prefix, hero, copy, challenge }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [atmosphere, setAtmosphere] = useState<PublicAtmosphereId>("aurora");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>("pending");
  const [sceneVisible, setSceneVisible] = useState(true);
  const [compactScene, setCompactScene] = useState(false);
  const selected = copy.stages[activeIndex];
  const palette = useMemo(
    () => PUBLIC_ATMOSPHERES.find((item) => item.id === atmosphere)?.scene ?? PUBLIC_ATMOSPHERES[0].scene,
    [atmosphere],
  );

  const playTone = useCallback((kind: "control" | "theme" | "complete") => {
    if (!soundEnabled) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = audioRef.current ?? new AudioContextClass();
    audioRef.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = kind === "theme" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(kind === "complete" ? 620 : kind === "theme" ? 420 : 310, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "complete" ? 880 : 520, now + .12);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.035, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + .2);
  }, [soundEnabled]);

  const selectStage = useCallback((index: number) => {
    setActiveIndex(index);
    playTone(index === 7 ? "complete" : "control");
  }, [playTone]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 760px)");
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const savedSound = window.localStorage.getItem(SOUND_STORAGE_KEY);
    const initializeFrame = window.requestAnimationFrame(() => {
      if (PUBLIC_ATMOSPHERES.some((item) => item.id === savedTheme)) {
        setAtmosphere(savedTheme as PublicAtmosphereId);
      }
      setSoundEnabled(savedSound === "enabled");
      setCompactScene(compact.matches);
      setRenderMode(
        reduced.matches || constrainedDevice() || !supportsWebGL()
          ? "static"
          : "webgl",
      );
    });
    const updateCompact = () => setCompactScene(compact.matches);
    compact.addEventListener("change", updateCompact);
    return () => {
      window.cancelAnimationFrame(initializeFrame);
      compact.removeEventListener("change", updateCompact);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const revealItems = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    root.dataset.revealReady = "true";
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealItems.forEach((item) => { item.dataset.revealed = "true"; });
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.revealed = "true";
        observer.unobserve(entry.target);
      }
    }, { threshold: .12, rootMargin: "0px 0px -8%" });
    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = sceneHostRef.current;
    if (!host || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setSceneVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(host);
    const onVisibility = () => setSceneVisible(!document.hidden && host.getBoundingClientRect().bottom >= 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progressRef.current?.style.setProperty("--scroll-progress", String(progress));
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, a, [contenteditable='true']")) return;
      const index = Number.parseInt(event.key, 10) - 1;
      if (index >= 0 && index < copy.stages.length) selectStage(index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copy.stages.length, selectStage]);

  useEffect(() => () => {
    audioRef.current?.close().catch(() => undefined);
    document.body.style.cursor = "";
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    rootRef.current?.style.setProperty("--pointer-x", `${event.clientX}px`);
    rootRef.current?.style.setProperty("--pointer-y", `${event.clientY}px`);
  };

  const handleMagneticMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mag-x", `${(event.clientX - rect.left - rect.width / 2) * .1}px`);
    event.currentTarget.style.setProperty("--mag-y", `${(event.clientY - rect.top - rect.height / 2) * .1}px`);
  };

  const resetMagnetic = (event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.style.removeProperty("--mag-x");
    event.currentTarget.style.removeProperty("--mag-y");
  };

  const chooseAtmosphere = (id: PublicAtmosphereId) => {
    setAtmosphere(id);
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
    playTone("theme");
  };

  const toggleSound = () => {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "enabled" : "muted");
  };

  const staticReason = renderMode === "lost" ? "context-lost" : renderMode === "failed" ? "scene-failed" : "capability";
  const sceneStyle = {
    "--scene-active": palette.active,
    "--scene-accent": palette.accent,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={styles.experience}
      data-atmosphere={atmosphere}
      data-locale={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      onPointerMove={handlePointerMove}
    >
      <div className={styles.pointerHalo} aria-hidden="true" />
      <div className={styles.scrollProgress} ref={progressRef} role="progressbar" aria-label={copy.scrollProgress} aria-valuemin={0} aria-valuemax={100} />

      <section className={styles.hero} id="hero" data-reveal>
        <div className={styles.heroAtmosphere} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{hero.eyebrow}</p>
          <h1>{hero.title}</h1>
          <p className={styles.lead}>{hero.lead}</p>
          <div className={styles.heroActions}>
            <Link
              href="#workflow"
              className={`${styles.primaryAction} ${styles.magnetic}`}
              onPointerMove={handleMagneticMove}
              onPointerLeave={resetMagnetic}
            >
              {hero.primaryAction}<ArrowRight className={styles.directionalIcon} size={19} aria-hidden="true" />
            </Link>
            <Link
              href={`${prefix}/contact`}
              className={`${styles.secondaryAction} ${styles.magnetic}`}
              onPointerMove={handleMagneticMove}
              onPointerLeave={resetMagnetic}
            >
              {hero.secondaryAction}
            </Link>
          </div>
          <p className={styles.trust}><ShieldCheck size={18} aria-hidden="true" />{hero.trustNote}</p>
        </div>

        <div className={styles.heroConsole} data-testid="workflow-console" style={sceneStyle}>
          <div className={styles.consoleToolbar}>
            <div>
              <span>{copy.consoleTitle}</span>
              <small>{copy.keyboardHint}</small>
            </div>
            <button
              type="button"
              className={styles.soundToggle}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? copy.soundDisable : copy.soundEnable}
              title={soundEnabled ? copy.soundDisable : copy.soundMuted}
              onClick={toggleSound}
            >
              {soundEnabled ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
            </button>
          </div>
          <div className={styles.sceneHost} ref={sceneHostRef} data-mode={renderMode}>
            {renderMode === "webgl" ? (
              <SceneBoundary onError={() => setRenderMode("failed")}>
                <WorkflowScene
                  activeIndex={activeIndex}
                  atmosphere={atmosphere}
                  active={sceneVisible}
                  compact={compactScene}
                  onSelect={selectStage}
                  onContextLost={() => setRenderMode("lost")}
                />
              </SceneBoundary>
            ) : (
              <StaticConsole activeIndex={activeIndex} />
            )}
            {renderMode === "pending" ? <span className={styles.sceneStatus}>{copy.sceneLoading}</span> : null}
            {renderMode !== "webgl" && renderMode !== "pending" ? (
              <span className={styles.sceneStatus} data-testid="workflow-fallback" data-reason={staticReason}>{copy.staticFallback}</span>
            ) : null}
          </div>
          <div className={styles.activeStage} aria-live="polite">
            <span>{String(activeIndex + 1).padStart(2, "0")} · {copy.selectedStage}</span>
            <strong>{selected.title}</strong>
            <p>{selected.body}</p>
          </div>
        </div>

        <div className={styles.experienceControls}>
          <fieldset className={styles.themePicker}>
            <legend><Palette size={16} aria-hidden="true" />{copy.atmosphereLabel}</legend>
            <div>
              {PUBLIC_ATMOSPHERES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-theme={item.id}
                  aria-pressed={atmosphere === item.id}
                  onClick={() => chooseAtmosphere(item.id)}
                >
                  <i aria-hidden="true" />{copy.themes[item.id]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <div className={styles.challengeBoundary}>{challenge}</div>

      <section className={styles.workflowSection} id="workflow" data-reveal>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>{copy.sections.workflowEyebrow}</p>
          <h2>{copy.sections.workflowTitle}</h2>
          <p>{copy.sections.workflowLead}</p>
        </div>
        <div className={styles.workflowLayout}>
          <div className={styles.stageRail} role="tablist" aria-label={copy.workflowControls}>
            {copy.stages.map((stage, index) => {
              const Icon = stageIcons[index];
              return (
                <button
                  key={stage.id}
                  id={`workflow-tab-${stage.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeIndex === index}
                  aria-controls={`workflow-panel-${stage.id}`}
                  onClick={() => selectStage(index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={19} aria-hidden="true" />
                  <strong>{stage.title}</strong>
                </button>
              );
            })}
          </div>
          <article
            className={styles.stagePanel}
            id={`workflow-panel-${selected.id}`}
            role="tabpanel"
            aria-labelledby={`workflow-tab-${selected.id}`}
          >
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <div>
              <h3>{selected.title}</h3>
              <p>{selected.detail}</p>
            </div>
            <Link href={`${prefix}/procurement-process#${selected.id}`}>
              {copy.exploreStage}<ArrowRight className={styles.directionalIcon} size={17} aria-hidden="true" />
            </Link>
          </article>
        </div>
      </section>

      <section className={styles.howSection} data-reveal>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>{copy.sections.howEyebrow}</p>
          <h2>{copy.sections.howTitle}</h2>
          <p>{copy.sections.howLead}</p>
        </div>
        <div className={styles.howGrid}>
          {copy.sections.howItems.map((item, index) => (
            <article key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3><p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.benefitsSection} data-reveal>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>{copy.sections.benefitsEyebrow}</p>
          <h2>{copy.sections.benefitsTitle}</h2>
        </div>
        <div className={styles.cardGrid}>
          {copy.sections.benefits.map((item, index) => {
            const Icon = benefitIcons[index];
            return <article key={item.title}><Icon size={25} aria-hidden="true" /><h3>{item.title}</h3><p>{item.body}</p></article>;
          })}
        </div>
      </section>

      <section className={styles.rolesSection} data-reveal>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>{copy.sections.rolesEyebrow}</p>
          <h2>{copy.sections.rolesTitle}</h2>
        </div>
        <div className={styles.roleGrid}>
          {copy.sections.roles.map((item, index) => {
            const Icon = roleIcons[index];
            return <article key={item.title} data-testid="public-role-card"><span><Icon size={23} aria-hidden="true" /></span><h3>{item.title}</h3><p>{item.body}</p></article>;
          })}
        </div>
      </section>

      <section className={styles.deliverySecurity} data-reveal>
        <article className={styles.deliveryPanel}>
          <p className={styles.eyebrow}>{copy.sections.deliveryEyebrow}</p>
          <h2>{copy.sections.deliveryTitle}</h2>
          <p>{copy.sections.deliveryBody}</p>
          <ol className={styles.deliveryRoute}>
            {copy.sections.deliveryProofs.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}
          </ol>
          <Truck className={styles.panelIcon} size={110} aria-hidden="true" />
        </article>
        <article className={styles.securityPanel} id="security">
          <p className={styles.eyebrow}>{copy.sections.securityEyebrow}</p>
          <h2>{copy.sections.securityTitle}</h2>
          <p>{copy.sections.securityBody}</p>
          <ul>{copy.sections.securityPoints.map((item) => <li key={item}><ShieldCheck size={18} aria-hidden="true" />{item}</li>)}</ul>
        </article>
      </section>

      <section className={styles.portalSection} data-reveal>
        <div>
          <p className={styles.eyebrow}>{copy.sections.portalEyebrow}</p>
          <h2>{copy.sections.portalTitle}</h2>
          <p>{copy.sections.portalBody}</p>
          <Link href={`${prefix}/company-procurement`}>
            {copy.exploreStage}<ArrowRight className={styles.directionalIcon} size={17} aria-hidden="true" />
          </Link>
        </div>
        <PortalPreview copy={copy} />
      </section>

      <section className={styles.contactSection} data-reveal>
        <Sparkles size={31} aria-hidden="true" />
        <div><p className={styles.eyebrow}>{copy.sections.contactEyebrow}</p><h2>{copy.sections.contactTitle}</h2><p>{copy.sections.contactBody}</p></div>
        <Link
          href={`${prefix}/contact`}
          className={styles.magnetic}
          onPointerMove={handleMagneticMove}
          onPointerLeave={resetMagnetic}
        >
          {copy.sections.contactAction}<ArrowRight className={styles.directionalIcon} size={18} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
