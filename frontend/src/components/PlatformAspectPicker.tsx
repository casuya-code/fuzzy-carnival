"use client";

import InfoTip from "@/components/InfoTip";
import { PLATFORM_ASPECTS, type AspectRatio } from "@/lib/platformAspects";

interface Props {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
  compact?: boolean;
  className?: string;
}

/** Short platform chips that map to the existing aspect ratios. */
export default function PlatformAspectPicker({ value, onChange, compact = false, className = "" }: Props) {
  return (
    <div role="group" aria-label="Platform aspect" className={`flex flex-wrap gap-1 ${className}`}>
      {PLATFORM_ASPECTS.map((option) => (
        <button
          key={option.ratio}
          type="button"
          aria-pressed={value === option.ratio}
          onClick={() => onChange(option.ratio)}
          className={`${compact ? "rounded px-1.5 py-1 text-[11px]" : "rounded-md px-2 py-1.5 text-xs font-medium"} border transition ${
            value === option.ratio
              ? "border-purple-500 bg-purple-600 text-white"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {option.label}
          <InfoTip text={`${option.tip} (${option.ratio})`} label={`${option.label} aspect`} focusable={false} />
        </button>
      ))}
    </div>
  );
}
