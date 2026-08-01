import type { InteractionConfig } from "@/lib/interactions/schema";
import { useId } from "react";

type AxoraBuddyProps = Pick<
  InteractionConfig,
  "accessibleLabel" | "colorTreatment" | "semanticRole"
> & {
  staticFallback?: boolean;
};

/**
 * Original Axora artwork. The trusted renderer owns all behaviour; this SVG is
 * deliberately inert and contains no downloaded or executable asset content.
 */
export function AxoraBuddy({
  accessibleLabel,
  colorTreatment,
  semanticRole,
  staticFallback = false,
}: AxoraBuddyProps) {
  const decorative = semanticRole === "decorative";
  const definitionId = useId().replaceAll(":", "");
  const bodyGradientId = `${definitionId}-body`;
  const glowGradientId = `${definitionId}-glow`;
  const shadowFilterId = `${definitionId}-shadow`;

  return (
    <svg
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : accessibleLabel ?? undefined}
      className="axora-buddy-art"
      data-color-treatment={colorTreatment}
      data-static-fallback={staticFallback ? "true" : "false"}
      focusable="false"
      role={decorative ? undefined : "img"}
      viewBox="0 0 104 118"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={bodyGradientId} x1="18" x2="86" y1="24" y2="96">
          <stop stopColor="#173f5f" />
          <stop offset="1" stopColor="#081a2c" />
        </linearGradient>
        <linearGradient id={glowGradientId} x1="23" x2="79" y1="31" y2="88">
          <stop stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
        <filter id={shadowFilterId} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="6" floodColor="#081a2c" floodOpacity=".2" stdDeviation="5" />
        </filter>
      </defs>

      <ellipse className="axora-buddy-ground" cx="52" cy="109" rx="29" ry="6" fill="#102a43" opacity=".16" />

      <g className="axora-buddy-character" filter={`url(#${shadowFilterId})`}>
        <g className="axora-buddy-antenna">
          <path d="M52 22V13" stroke="#173f5f" strokeLinecap="round" strokeWidth="5" />
          <circle cx="52" cy="9" r="5" fill="#2dd4bf" stroke="#fff" strokeWidth="2" />
        </g>

        <g className="axora-buddy-arms" fill="none" stroke="#173f5f" strokeLinecap="round" strokeWidth="7">
          <path className="axora-buddy-arm-left" d="M21 55 10 66" />
          <path className="axora-buddy-arm-right" d="m83 55 11 11" />
        </g>

        <rect x="19" y="23" width="66" height="72" rx="24" fill={`url(#${bodyGradientId})`} />
        <rect x="25" y="30" width="54" height="48" rx="18" fill="#f8fafc" />
        <path d="M31 68c7 8 35 8 42 0" fill="none" stroke="#cbd5e1" strokeLinecap="round" strokeWidth="3" />

        <g className="axora-buddy-face">
          <rect className="axora-buddy-eye" x="34" y="45" width="11" height="13" rx="5.5" fill={`url(#${glowGradientId})`} />
          <rect className="axora-buddy-eye" x="59" y="45" width="11" height="13" rx="5.5" fill={`url(#${glowGradientId})`} />
          <path className="axora-buddy-smile" d="M43 64c5 4 13 4 18 0" fill="none" stroke="#0f9d8a" strokeLinecap="round" strokeWidth="3" />
        </g>

        <path d="M35 93v12" stroke="#173f5f" strokeLinecap="round" strokeWidth="9" />
        <path d="M69 93v12" stroke="#173f5f" strokeLinecap="round" strokeWidth="9" />
        <path d="M27 106h16" stroke="#102a43" strokeLinecap="round" strokeWidth="7" />
        <path d="M61 106h16" stroke="#102a43" strokeLinecap="round" strokeWidth="7" />

        <circle cx="52" cy="86" r="4.5" fill="#2dd4bf" />
      </g>
    </svg>
  );
}
