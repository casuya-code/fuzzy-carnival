"use client";

import { useEffect, useState } from "react";

interface ProgressBarProps {
  /** Whether the bar is active. */
  active: boolean;
  /** Optional label shown above the bar. */
  label?: string;
  /** Height in px. */
  height?: number;
  /** Color class for the bar fill. */
  color?: string;
  /** Optional 0-100 value for determinate mode; omit for indeterminate. */
  value?: number;
}

/**
 * Horizontal progress bar. Indeterminate (animated) by default; pass `value`
 * for a determinate 0-100 fill. Designed to be dropped into any loading state.
 */
export default function ProgressBar({
  active,
  label,
  height = 6,
  color = "bg-blue-600",
  value,
}: ProgressBarProps) {
  const [indeterminatePos, setIndeterminatePos] = useState(0);

  useEffect(() => {
    if (!active || value !== undefined) return;
    let raf = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      // Ping-pong between 0 and 1 over ~1.6s.
      const p = (Math.sin(t * (Math.PI / 0.8)) + 1) / 2;
      setIndeterminatePos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);

  if (!active) return null;

  const determinate = value !== undefined;
  const pct = determinate ? Math.max(0, Math.min(100, value!)) : null;

  return (
    <div className="w-full">
      {label ? <div className="mb-1 text-xs font-medium text-gray-600">{label}</div> : null}
      <div
        className="w-full overflow-hidden rounded-full bg-gray-200"
        style={{ height }}
        role="progressbar"
        aria-valuenow={determinate ? pct! : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {determinate ? (
          <div
            className={`h-full rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div
            className={`h-full rounded-full ${color}`}
            style={{
              width: "35%",
              transform: `translateX(${indeterminatePos * 185}%)`,
              transition: "transform 0.05s linear",
            }}
          />
        )}
      </div>
    </div>
  );
}

interface PartProgressProps {
  /** List of part labels. */
  parts: string[];
  /** Index of the currently active part (0-based), or -1 if none. */
  activeIndex: number;
  /** Whether the whole operation is running. */
  active: boolean;
}

/**
 * Multi-part progress: shows a horizontal bar per part, highlighting the
 * active one with an animated fill and marking completed ones as full.
 */
export function PartProgress({ parts, activeIndex, active }: PartProgressProps) {
  if (!active && activeIndex < 0) return null;
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        const done = activeIndex > i || (!active && activeIndex === -1 && i < parts.length);
        const isActive = active && i === activeIndex;
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className={isActive ? "font-semibold text-blue-700" : done ? "text-gray-500" : "text-gray-400"}>
                {done ? "✓ " : isActive ? "▸ " : "  "}{p}
              </span>
              {isActive ? <span className="text-blue-600">processing…</span> : done ? <span className="text-green-600">done</span> : null}
            </div>
            <ProgressBar
              active={isActive || done}
              value={done ? 100 : undefined}
              height={4}
              color={done ? "bg-green-500" : "bg-blue-600"}
            />
          </div>
        );
      })}
    </div>
  );
}