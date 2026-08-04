"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useFormStatus } from "react-dom";
import styles from "../LoginForm.module.css";

export type GuideFocus = "email" | "password" | null;
type GuideState =
  | "idle"
  | "email"
  | "private"
  | "peek"
  | "success"
  | "error"
  | "loading";
type MouthState = "small" | "medium" | "large";

const YETI_SVG_URL = "/login-yeti.svg";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function querySvg<T extends Element>(root: HTMLElement, selector: string) {
  return root.querySelector<T>(selector);
}

function cancelAnimations(element: Element | null) {
  element?.getAnimations().forEach((animation) => animation.cancel());
}

function setTransform(
  element: SVGGraphicsElement | null,
  transform: string,
  reducedMotion: boolean,
  duration = 1000,
  easing = "cubic-bezier(.16,1,.3,1)",
) {
  if (!element) return;
  cancelAnimations(element);
  element.style.transformBox = "fill-box";
  element.style.transition = reducedMotion
    ? "none"
    : `transform ${duration}ms ${easing}`;
  element.style.transform = transform;
}

function resetFace(root: HTMLElement, reducedMotion: boolean, eyeScale = 1) {
  setTransform(
    querySvg(root, ".eyeL"),
    `translate(0px, 0px) scale(${eyeScale})`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".eyeR"),
    `translate(0px, 0px) scale(${eyeScale})`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".nose"),
    "translate(0px, 0px) rotate(0deg)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".mouth"),
    "translate(0px, 0px) rotate(0deg)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".chin"),
    "translate(0px, 0px) scaleY(1)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".face"),
    "translate(0px, 0px) skewX(0deg)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".eyebrow"),
    "translate(0px, 0px) skewX(0deg)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earL .outerEar"),
    "translate(0px, 0px)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earR .outerEar"),
    "translate(0px, 0px)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earL .earHair"),
    "translate(0px, 0px)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earR .earHair"),
    "translate(0px, 0px)",
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".hair"),
    "translate(0px, 0px) scaleY(1)",
    reducedMotion,
  );
}

function mouthStateFor(value: string): MouthState {
  if (!value) return "small";
  return value.includes("@") ? "large" : "medium";
}

function applyMouthState(
  root: HTMLElement,
  state: MouthState,
  reducedMotion: boolean,
) {
  const source = querySvg<SVGPathElement>(
    root,
    `.mouth${
      state === "small" ? "Small" : state === "medium" ? "Medium" : "Large"
    }BG`,
  );
  const d = source?.getAttribute("d");
  if (!d) return 1;

  for (const selector of [".mouthBG", ".mouthOutline", "#mouthMaskPath"]) {
    querySvg<SVGPathElement>(root, selector)?.setAttribute("d", d);
  }

  const tooth = querySvg<SVGGraphicsElement>(root, ".tooth");
  const tongue = querySvg<SVGGraphicsElement>(root, ".tongue");
  const eyeScale = state === "large" ? 0.65 : state === "medium" ? 0.85 : 1;

  setTransform(
    tooth,
    state === "large" ? "translate(3px, -2px)" : "translate(0px, 0px)",
    reducedMotion,
  );
  setTransform(
    tongue,
    state === "large"
      ? "translate(0px, 2px)"
      : state === "medium"
        ? "translate(0px, 1px)"
        : "translate(0px, 0px)",
    reducedMotion,
  );

  return eyeScale;
}

function caretTarget(
  input: HTMLInputElement,
  svg: SVGSVGElement,
  value: string,
  caretIndex: number,
) {
  const inputRect = input.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font =
    style.font && style.font !== ""
      ? style.font
      : `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if (context) context.font = font;

  const measured = context?.measureText(value.slice(0, caretIndex)).width ?? 0;
  const paddingInlineStart =
    Number.parseFloat(
      style.direction === "rtl" ? style.paddingRight : style.paddingLeft,
    ) || 0;
  const paddingInlineEnd =
    Number.parseFloat(
      style.direction === "rtl" ? style.paddingLeft : style.paddingRight,
    ) || 0;
  const logicalX =
    style.direction === "rtl"
      ? inputRect.right - paddingInlineStart - measured + input.scrollLeft
      : inputRect.left + paddingInlineStart + measured - input.scrollLeft;
  const minX = inputRect.left + paddingInlineEnd;
  const maxX = inputRect.right - paddingInlineEnd;
  const screenX = Math.max(minX, Math.min(maxX, logicalX));
  const screenY = inputRect.top + inputRect.height * 0.55;

  return {
    x: ((screenX - svgRect.left) / svgRect.width) * 200,
    y: ((screenY - svgRect.top) / svgRect.height) * 200,
  };
}

function angle(x1: number, y1: number, x2: number, y2: number) {
  return Math.atan2(y1 - y2, x1 - x2);
}

function moveFaceToCaret(
  root: HTMLElement,
  input: HTMLInputElement,
  value: string,
  caretIndex: number,
  reducedMotion: boolean,
) {
  const svg = querySvg<SVGSVGElement>(root, "svg");
  if (!svg || svg.clientWidth === 0 || svg.clientHeight === 0) return;

  const target = caretTarget(input, svg, value, caretIndex);
  const screenCenter = 100;
  const dFromCenter = screenCenter - target.x;
  const eyeLAngle = angle(84, 76, target.x, target.y);
  const eyeRAngle = angle(113, 76, target.x, target.y);
  const noseAngle = angle(97, 81, target.x, target.y);
  const mouthAngle = angle(100, 100, target.x, target.y);
  const eyeLX = Math.cos(eyeLAngle) * 20;
  const eyeLY = Math.sin(eyeLAngle) * 10;
  const eyeRX = Math.cos(eyeRAngle) * 20;
  const eyeRY = Math.sin(eyeRAngle) * 10;
  const noseX = Math.cos(noseAngle) * 23;
  const noseY = Math.sin(noseAngle) * 10;
  const mouthX = Math.cos(mouthAngle) * 23;
  const mouthY = Math.sin(mouthAngle) * 10;
  const mouthRotation = Math.cos(mouthAngle) * 6;
  const chinX = mouthX * 0.8;
  const chinY = mouthY * 0.5;
  let chinScale = 1 - (dFromCenter * 0.15) / 100;
  if (chinScale > 1) chinScale = Math.max(0.5, 1 - (chinScale - 1));
  const faceX = mouthX * 0.3;
  const faceY = mouthY * 0.4;
  const faceSkew = Math.cos(mouthAngle) * 5;
  const eyebrowSkew = Math.cos(mouthAngle) * 25;
  const outerEarX = Math.cos(mouthAngle) * 4;
  const outerEarY = Math.cos(mouthAngle) * 5;
  const hairX = Math.cos(mouthAngle) * 6;
  const eyeScale = applyMouthState(
    root,
    mouthStateFor(value),
    reducedMotion,
  );

  setTransform(
    querySvg(root, ".eyeL"),
    `translate(${-eyeLX}px, ${-eyeLY}px) scale(${eyeScale})`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".eyeR"),
    `translate(${-eyeRX}px, ${-eyeRY}px) scale(${eyeScale})`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".nose"),
    `translate(${-noseX}px, ${-noseY}px) rotate(${mouthRotation}deg)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".mouth"),
    `translate(${-mouthX}px, ${-mouthY}px) rotate(${mouthRotation}deg)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".chin"),
    `translate(${-chinX}px, ${-chinY}px) scaleY(${chinScale})`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".face"),
    `translate(${-faceX}px, ${-faceY}px) skewX(${-faceSkew}deg)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".eyebrow"),
    `translate(${-faceX}px, ${-faceY}px) skewX(${-eyebrowSkew}deg)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earL .outerEar"),
    `translate(${outerEarX}px, ${-outerEarY}px)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earR .outerEar"),
    `translate(${outerEarX}px, ${outerEarY}px)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earL .earHair"),
    `translate(${-outerEarX}px, ${-outerEarY}px)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".earR .earHair"),
    `translate(${-outerEarX}px, ${outerEarY}px)`,
    reducedMotion,
  );
  setTransform(
    querySvg(root, ".hair"),
    `translate(${hairX}px, 0px) scaleY(1.2)`,
    reducedMotion,
  );
}

export function YetiGuide({
  focus,
  emailValue,
  caretIndex,
  emailRef,
  passwordVisible,
  error,
  success,
}: {
  focus: GuideFocus;
  emailValue: string;
  caretIndex: number;
  emailRef: RefObject<HTMLInputElement | null>;
  passwordVisible: boolean;
  error: boolean;
  success: boolean;
}) {
  const { pending } = useFormStatus();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const faceFrameRef = useRef<number | null>(null);
  const armFrameRef = useRef<number | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const state: GuideState = pending
    ? "loading"
    : error
      ? "error"
      : success
        ? "success"
        : focus === "password"
          ? passwordVisible
            ? "peek"
            : "private"
          : focus === "email"
            ? "email"
            : "idle";

  useEffect(() => {
    const controller = new AbortController();

    fetch(YETI_SVG_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load login artwork.");
        return response.text();
      })
      .then((markup) => setSvgMarkup(markup))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
      });

    return () => controller.abort();
  }, []);

  // Inject the trusted local SVG once. React must not own or replace these
  // animated nodes on every controlled-input render.
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host || !svgMarkup) return;

    host.innerHTML = svgMarkup;

    return () => {
      host.replaceChildren();
    };
  }, [svgMarkup]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !svgMarkup) return;

    const leftArm = querySvg<SVGGElement>(root, ".armL");
    const rightArm = querySvg<SVGGElement>(root, ".armR");
    const coveredBody = querySvg<SVGPathElement>(root, ".bodyBGchanged");
    const normalBody = querySvg<SVGPathElement>(root, ".bodyBGnormal");

    setTransform(leftArm, "translate(-93px, 220px) rotate(105deg)", true);
    setTransform(rightArm, "translate(-93px, 220px) rotate(-105deg)", true);
    if (leftArm) leftArm.style.visibility = "hidden";
    if (rightArm) rightArm.style.visibility = "hidden";
    if (coveredBody) {
      coveredBody.style.display = "none";
      coveredBody.style.opacity = "0";
    }
    if (normalBody) normalBody.style.opacity = "1";
  }, [svgMarkup]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !svgMarkup) return;
    const leftArm = querySvg<SVGGElement>(root, ".armL");
    const rightArm = querySvg<SVGGElement>(root, ".armR");
    const normalBody = querySvg<SVGPathElement>(root, ".bodyBGnormal");
    const coveredBody = querySvg<SVGPathElement>(root, ".bodyBGchanged");
    let hideTimer: number | undefined;

    if (armFrameRef.current !== null) {
      window.cancelAnimationFrame(armFrameRef.current);
      armFrameRef.current = null;
    }

    if (focus === "password") {
      if (leftArm) leftArm.style.visibility = "visible";
      if (rightArm) rightArm.style.visibility = "visible";
      if (coveredBody) {
        coveredBody.style.display = "block";
        coveredBody.style.opacity = "1";
      }
      if (normalBody) normalBody.style.opacity = "0";

      armFrameRef.current = window.requestAnimationFrame(() => {
        setTransform(
          leftArm,
          "translate(-93px, 10px) rotate(0deg)",
          reducedMotion,
          450,
          "ease-out",
        );
        setTransform(
          rightArm,
          "translate(-93px, 10px) rotate(0deg)",
          reducedMotion,
          450,
          "ease-out",
        );
        armFrameRef.current = null;
      });
    } else {
      setTransform(
        leftArm,
        "translate(-93px, 220px) rotate(105deg)",
        reducedMotion,
        1350,
        "ease-out",
      );
      setTransform(
        rightArm,
        "translate(-93px, 220px) rotate(-105deg)",
        reducedMotion,
        1350,
        "ease-out",
      );
      if (normalBody) normalBody.style.opacity = "1";
      if (coveredBody) coveredBody.style.opacity = "0";

      hideTimer = window.setTimeout(() => {
        if (leftArm) leftArm.style.visibility = "hidden";
        if (rightArm) rightArm.style.visibility = "hidden";
        if (coveredBody) coveredBody.style.display = "none";
      }, reducedMotion ? 0 : 1350);
    }

    return () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      if (armFrameRef.current !== null) {
        window.cancelAnimationFrame(armFrameRef.current);
        armFrameRef.current = null;
      }
    };
  }, [focus, reducedMotion, svgMarkup]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !svgMarkup) return;
    const fingers = querySvg<SVGGElement>(root, ".twoFingers");
    setTransform(
      fingers,
      passwordVisible
        ? "translate(-9px, -2px) rotate(30deg)"
        : "translate(0px, 0px) rotate(0deg)",
      reducedMotion,
      350,
      "ease-in-out",
    );
  }, [passwordVisible, reducedMotion, svgMarkup]);

  useEffect(() => {
    const root = rootRef.current;
    const input = emailRef.current;
    if (!root || !svgMarkup) return;

    if (faceFrameRef.current !== null) {
      window.cancelAnimationFrame(faceFrameRef.current);
    }

    faceFrameRef.current = window.requestAnimationFrame(() => {
      if (focus === "email" && input) {
        moveFaceToCaret(
          root,
          input,
          emailValue,
          caretIndex,
          reducedMotion,
        );
      } else {
        const eyeScale = applyMouthState(
          root,
          mouthStateFor(emailValue),
          reducedMotion,
        );
        resetFace(root, reducedMotion, eyeScale);
      }
      faceFrameRef.current = null;
    });

    return () => {
      if (faceFrameRef.current !== null) {
        window.cancelAnimationFrame(faceFrameRef.current);
        faceFrameRef.current = null;
      }
    };
  }, [caretIndex, emailRef, emailValue, focus, reducedMotion, svgMarkup]);

  useEffect(() => {
    if (focus !== "email" || !svgMarkup) return;

    const updateAfterLayoutChange = () => {
      const root = rootRef.current;
      const input = emailRef.current;
      if (!root || !input) return;

      if (faceFrameRef.current !== null) {
        window.cancelAnimationFrame(faceFrameRef.current);
      }
      faceFrameRef.current = window.requestAnimationFrame(() => {
        moveFaceToCaret(
          root,
          input,
          emailValue,
          caretIndex,
          reducedMotion,
        );
        faceFrameRef.current = null;
      });
    };

    window.addEventListener("resize", updateAfterLayoutChange);
    window.visualViewport?.addEventListener("resize", updateAfterLayoutChange);

    return () => {
      window.removeEventListener("resize", updateAfterLayoutChange);
      window.visualViewport?.removeEventListener(
        "resize",
        updateAfterLayoutChange,
      );
    };
  }, [caretIndex, emailRef, emailValue, focus, reducedMotion, svgMarkup]);

  // Blink only while idle so a blink animation cannot overwrite active
  // email tracking or password-cover transforms.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !svgMarkup || reducedMotion || focus !== null) return;
    let timer: number | undefined;
    let cancelled = false;
    const activeAnimations: Animation[] = [];

    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        activeAnimations.length = 0;

        for (const selector of [".eyeL", ".eyeR"]) {
          const eye = querySvg<SVGGraphicsElement>(root, selector);
          if (!eye) continue;
          const base =
            eye.style.transform || "translate(0px, 0px) scale(1)";
          const animation = eye.animate(
            [
              { transform: base },
              { transform: `${base} scaleY(0.05)` },
              { transform: base },
            ],
            { duration: 200, easing: "ease-in-out" },
          );
          activeAnimations.push(animation);
        }

        schedule();
      }, 2000 + Math.floor(Math.random() * 9000));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      activeAnimations.forEach((animation) => animation.cancel());
    };
  }, [focus, reducedMotion, svgMarkup]);

  return (
    <div
      ref={rootRef}
      className={`${styles.svgContainer} svgContainer login-guide`}
      data-state={state}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
    >
      <div ref={svgHostRef} aria-hidden="true" />
    </div>
  );
}
