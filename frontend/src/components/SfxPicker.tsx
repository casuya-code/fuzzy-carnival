"use client";

import InfoTip from "@/components/InfoTip";
import { SFX_OPTIONS, type SfxId } from "@/lib/transitionSfx";

interface Props {
  value: SfxId;
  level: number;
  onValueChange: (value: SfxId) => void;
  onLevelChange: (level: number) => void;
}

/** Compact transition-sound controls with the detail hidden in a tooltip. */
export default function SfxPicker({ value, level, onValueChange, onLevelChange }: Props) {
  const selected = SFX_OPTIONS.find((option) => option.id === value) ?? SFX_OPTIONS[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">SFX</span>
        <InfoTip
          text="Sounds are generated on the server at each cut. No stock audio or API key is used."
          label="Transition SFX"
        />
      </div>
      <select
        value={selected.id}
        onChange={(e) => onValueChange(e.target.value as SfxId)}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        aria-label="Transition sound"
      >
        {SFX_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {value !== "off" && (
        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
            Level
            <InfoTip text={selected.tip} label={`${selected.label} sound`} />
          </span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={level}
              onChange={(e) => onLevelChange(parseInt(e.target.value))}
              className="w-full accent-blue-600"
            />
            <span className="w-8 text-right font-mono text-[11px] tabular-nums">{level}%</span>
          </span>
        </label>
      )}
    </div>
  );
}
