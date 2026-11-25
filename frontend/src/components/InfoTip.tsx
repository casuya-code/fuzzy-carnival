import type { ReactNode } from "react";

type Placement = "top" | "bottom" | "right";

interface Props {
  /** Full explanation shown when the user hovers or focuses the "i". */
  text: ReactNode;
  /** Short accessible name for the icon. */
  label?: string;
  placement?: Placement;
  /** Set false when the icon is inside a link or button. */
  focusable?: boolean;
  className?: string;
}

const placementClass: Record<Placement, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * Small "i" that keeps pages short: the full explanation lives in the tooltip.
 */
export default function InfoTip({
  text,
  label = "More info",
  placement = "top",
  focusable = true,
  className = "",
}: Props) {
  return (
    <span className={`group/tip relative inline-flex shrink-0 align-middle ${className}`}>
      <span
        role="img"
        aria-label={`${label}: ${typeof text === "string" ? text : label}`}
        tabIndex={focusable ? 0 : undefined}
        className="flex h-[15px] w-[15px] cursor-help items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none text-gray-500 outline-none transition hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
      >
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 hidden w-max max-w-[16rem] rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white shadow-lg group-hover/tip:block group-focus-within/tip:block ${placementClass[placement]}`}
      >
        {text}
      </span>
    </span>
  );
}
