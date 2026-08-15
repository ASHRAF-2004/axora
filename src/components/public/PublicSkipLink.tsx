"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function PublicSkipLink({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <a
    className="skip-link"
    data-focus-ready={ready}
    href="#main-content"
    onClick={(event) => {
      const target = document.getElementById("main-content");
      if (!target) return;
      event.preventDefault();
      if (window.location.hash !== "#main-content") {
        window.history.pushState(null, "", "#main-content");
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }}
  >
    {children}
  </a>;
}
