"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = [
  ".app-content > section",
  ".app-content > article",
  ".app-content > div > .panel",
  ".catalog-product-card",
  ".shop-product-card",
  ".public-main > section",
].join(",");

export function InteractionMagic() {
  const pathname = usePathname();

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    const pointerLight = document.querySelector<HTMLElement>(".interaction-pointer-light");
    let pointerAnimation: Animation | null = null;

    function updatePointer(event: PointerEvent) {
      if (reducedMotion.matches || !finePointer.matches || !pointerLight) return;
      const currentTransform = getComputedStyle(pointerLight).transform;
      pointerAnimation?.cancel();
      pointerAnimation = pointerLight.animate([
        { transform: currentTransform === "none" ? undefined : currentTransform },
        { transform: `translate3d(calc(${event.clientX}px - 50%), calc(${event.clientY}px - 50%), 0)` },
      ], {
        duration: 220,
        easing: "cubic-bezier(.22, 1, .36, 1)",
        fill: "forwards",
      });
    }

    const revealables = Array.from(
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
    );
    const observer = "IntersectionObserver" in window && !reducedMotion.matches
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.animate([
              { opacity: 0, transform: "translateY(13px)" },
              { opacity: 1, transform: "translateY(0)" },
            ], {
              duration: 520,
              easing: "cubic-bezier(.22, 1, .36, 1)",
            });
            observer?.unobserve(entry.target);
          }
        }, { rootMargin: "0px 0px -7%", threshold: 0.08 })
      : null;

    for (const element of revealables) {
      if (observer) observer.observe(element);
    }

    window.addEventListener("pointermove", updatePointer, { passive: true });
    return () => {
      pointerAnimation?.cancel();
      observer?.disconnect();
      window.removeEventListener("pointermove", updatePointer);
    };
  }, [pathname]);

  return (
    <div className="interaction-atmosphere" aria-hidden="true">
      <span className="interaction-pointer-light" />
      <span className="interaction-orbit interaction-orbit-one" />
      <span className="interaction-orbit interaction-orbit-two" />
    </div>
  );
}
