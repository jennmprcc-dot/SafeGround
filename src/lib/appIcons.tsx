/**
 * Shell icon set: re-exports shared icons and defines nav-specific glyphs.
 * All 24px, 2px stroke, round caps — and each carries a text label nearby.
 */
import type { SVGProps } from "react";
import { BellMoonIcon, CheckIcon, InfoIcon, MenuIcon } from "./icons";

export { BellMoonIcon, CheckIcon, InfoIcon, MenuIcon };

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function HomeIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function MoonIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M20 16.5A8.5 8.5 0 1 1 7.5 4a7 7 0 0 0 12.5 12.5z" />
      <path d="M17 7v.01M4 14h.01M8 19h.01" />
    </svg>
  );
}

/** Lamp/glow for the crisis-resources menu item — calm, not alarming. */
export function NightLampIcon(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M5 10a7 7 0 0 1 14 0c0 3.5-2.5 5-2.5 8h-9C7.5 15 5 13.5 5 10z" />
      <path d="M9.5 21h5" />
      <path d="M12 5v.01" />
    </svg>
  );
}