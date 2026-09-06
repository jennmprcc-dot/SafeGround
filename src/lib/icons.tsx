/**
 * SafeGround line icons — 24px, 2px stroke, round caps (DESIGN_SYSTEM §3).
 * All icons are decorative by default (aria-hidden) — meaning always ships
 * with a text label beside it. Never a siren or alarm triangle.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...props }: IconProps) {
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

export function BowlIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11a9 9 0 0 1 18 0" />
      <path d="M3 11h18v2a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7v-2z" />
      <path d="M7 6.5c0-1 1-1.5 1-3" />
      <path d="M12 5c0-1 1-1.5 1-3" />
      <path d="M17 6.5c0-1 1-1.5 1-3" />
    </svg>
  );
}

export function MoonBlanketIcon(props: IconProps) {
  /* moon + blanket/sleep */
  return (
    <svg {...base(props)}>
      <path d="M20 11.5A8.5 8.5 0 1 1 12.5 4a7 7 0 0 0 7.5 7.5z" />
      <path d="M4 17.5h16" />
      <path d="M6 17.5v-2.5h12v2.5" />
      <path d="M8 15v-3h8v3" />
    </svg>
  );
}

export function DropIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
      <path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  );
}

export function ShowerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 14h16v1.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V14z" />
      <path d="M3 14v3.5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V14" />
      <path d="M19 7v.01M16 8v.01M13 9v.01M10 10v.01M7 11v.01" />
      <path d="M18 12h-1" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

export function ScalesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M7 7 4.5 14a3 3 0 0 0 5 0L7 7z" />
      <path d="M17 7l-2.5 7a3 3 0 0 0 5 0L17 7z" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function BellMoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18.5 9.5a6 6 0 1 1-11-1.8" />
      <path d="M12 4a6.5 6.5 0 0 1 6.5 5.5" />
      <path d="M4 11.5a7 7 0 0 1 .5-2.5" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <path d="M15 8.5v.01" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M12 11.5V16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function MapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
      <path d="M8 6h12M8 12h12M8 18h12" />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 4h12v17l-6-4-6 4V4z" />
    </svg>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function NavigateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M16 8l-3.5 8.5L11 13 7.5 11.5 16 8z" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20.5C7 16.5 3 13 3 9a5 5 0 0 1 9-2.5A5 5 0 0 1 21 9c0 4-4 7.5-9 11.5z" />
    </svg>
  );
}

export function CatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9c-4 0-6 2.5-6 6 0 4.5 3 5 6 5s6-.5 6-5c0-3.5-2-6-6-6z" />
      <path d="M12 9v5M9.5 12c-1 1-1 3 0 4M14.5 12c1 1 1 3 0 4" />
    </svg>
  );
}