"use client";

import InfoTip from "@/components/InfoTip";

export const DEFAULT_TRANSITION = "fade";
export const DEFAULT_TRANSITION_DURATION_SEC = 0.5;

export interface TransitionOption {
  id: string;
  label: string;
  description: string;
}

export const TRANSITION_GROUPS: { label: string; items: TransitionOption[] }[] = [
  {
    label: "Fades & blurs",
    items: [
      { id: "fade", label: "Cross fade", description: "Smoothly dissolves one clip into the next." },
      { id: "dissolve", label: "Dissolve", description: "A softer, grainier cross fade." },
      { id: "fadeblack", label: "Through black", description: "Fades out to black, then fades in." },
      { id: "fadewhite", label: "Through white", description: "Flashes white between clips." },
      { id: "hblur", label: "Blur fade", description: "Blurs the outgoing clip while fading." },
      { id: "fadegrays", label: "Fade to gray", description: "Drains color before the next clip." },
      { id: "fadefast", label: "Fast fade", description: "A quick cross fade." },
      { id: "fadeslow", label: "Slow fade", description: "A gentle, lingering cross fade." },
      { id: "bloom", label: "Bloom", description: "Bright light flare between clips. Slower to render." },
      { id: "burn", label: "Burn", description: "Warm film-burn glow. Slower to render." },
    ],
  },
  {
    label: "Wipes & pushes",
    items: [
      { id: "smoothleft", label: "Soft wipe left", description: "Sweeps right to left with a soft edge." },
      { id: "smoothright", label: "Soft wipe right", description: "Sweeps left to right with a soft edge." },
      { id: "smoothup", label: "Soft wipe up", description: "Sweeps upward with a soft edge." },
      { id: "smoothdown", label: "Soft wipe down", description: "Sweeps downward with a soft edge." },
      { id: "wipeleft", label: "Wipe left", description: "Hard-edged sweep to the left." },
      { id: "wiperight", label: "Wipe right", description: "Hard-edged sweep to the right." },
      { id: "wipeup", label: "Wipe up", description: "Hard-edged sweep upward." },
      { id: "wipedown", label: "Wipe down", description: "Hard-edged sweep downward." },
      { id: "slideleft", label: "Push left", description: "New clip pushes the old one left." },
      { id: "slideright", label: "Push right", description: "New clip pushes the old one right." },
      { id: "slideup", label: "Push up", description: "New clip pushes the old one up." },
      { id: "slidedown", label: "Push down", description: "New clip pushes the old one down." },
      { id: "circleopen", label: "Circle open", description: "A circle expands to reveal the next clip." },
      { id: "circleclose", label: "Circle close", description: "A circle contracts to end the clip." },
      { id: "vertopen", label: "Barn doors vertical", description: "Opens from the center into vertical panels." },
      { id: "vertclose", label: "Barn doors close", description: "Closes vertical panels to the center." },
      { id: "horzopen", label: "Barn doors horizontal", description: "Opens from the center into horizontal panels." },
      { id: "horzclose", label: "Barn doors close", description: "Closes horizontal panels to the center." },
    ],
  },
  {
    label: "Geometric & slices",
    items: [
      { id: "diagtl", label: "Diagonal TL", description: "Diagonal wipe from the top-left." },
      { id: "diagtr", label: "Diagonal TR", description: "Diagonal wipe from the top-right." },
      { id: "diagbl", label: "Diagonal BL", description: "Diagonal wipe from the bottom-left." },
      { id: "diagbr", label: "Diagonal BR", description: "Diagonal wipe from the bottom-right." },
      { id: "hlslice", label: "Half-left slice", description: "Reveals using the left half of the frame." },
      { id: "hrslice", label: "Half-right slice", description: "Reveals using the right half of the frame." },
      { id: "vuslice", label: "Vertical up slice", description: "Vertical slices rise into place." },
      { id: "vdslice", label: "Vertical down slice", description: "Vertical slices drop into place." },
      { id: "pixelize", label: "Pixelate", description: "Blocks up the old clip, then sharpens the new one." },
      { id: "radial", label: "Radial wipe", description: "Reveals outward from the center." },
      { id: "squeezeh", label: "Squeeze horizontal", description: "Squeezes the frame left to right." },
      { id: "squeezev", label: "Squeeze vertical", description: "Squeezes the frame top to bottom." },
      { id: "circlecrop", label: "Circle crop", description: "Crops through a circular opening." },
      { id: "rectcrop", label: "Rectangle crop", description: "Crops through a rectangular opening." },
      { id: "distance", label: "Distance", description: "Depth-based reveal." },
      { id: "heart", label: "Heart", description: "A heart-shaped mask expands into the next clip. Slower to render." },
    ],
  },
  {
    label: "Motion & reveal",
    items: [
      { id: "zoomin", label: "Zoom in", description: "Pushes into the frame while switching." },
      { id: "coverleft", label: "Cover left", description: "New clip covers the old one from the left." },
      { id: "coverright", label: "Cover right", description: "New clip covers the old one from the right." },
      { id: "coverup", label: "Cover up", description: "New clip covers the old one upward." },
      { id: "coverdown", label: "Cover down", description: "New clip covers the old one downward." },
      { id: "revealleft", label: "Reveal left", description: "Slides away to uncover the next clip on the left." },
      { id: "revealright", label: "Reveal right", description: "Slides away to uncover the next clip on the right." },
      { id: "revealup", label: "Reveal up", description: "Slides up to uncover the next clip." },
      { id: "revealdown", label: "Reveal down", description: "Slides down to uncover the next clip." },
      { id: "hlwind", label: "Wind left", description: "Winds the frame away to the left." },
      { id: "hrwind", label: "Wind right", description: "Winds the frame away to the right." },
      { id: "vuwind", label: "Wind up", description: "Winds the frame upward." },
      { id: "vdwind", label: "Wind down", description: "Winds the frame downward." },
      { id: "exchange", label: "Exchange", description: "Mirrored panels swap places. Slower to render." },
    ],
  },
  {
    label: "Glitch, retro & stylized",
    items: [
      { id: "glitch", label: "Glitch", description: "Digital slices jump sideways. Slower to render." },
      { id: "glitchreveal", label: "Glitch reveal", description: "Jagged static uncovers the next clip. Slower to render." },
      { id: "banding", label: "Horizontal banding", description: "Wide scan bands bridge the clips. Slower to render." },
      { id: "fire", label: "Fire", description: "Warm flickering flames between scenes. Slower to render." },
      { id: "liquidstreaks", label: "Liquid streaks", description: "Rippling fluid streaks reveal the next clip. Slower to render." },
      { id: "liquiddrops", label: "Liquid drops", description: "Droplets expand into the next scene. Slower to render." },
    ],
  },
  {
    label: "Corner wipes",
    items: [
      { id: "wipetl", label: "From top-left", description: "Wipes diagonally from the top-left." },
      { id: "wipetr", label: "From top-right", description: "Wipes diagonally from the top-right." },
      { id: "wipebl", label: "From bottom-left", description: "Wipes diagonally from the bottom-left." },
      { id: "wipebr", label: "From bottom-right", description: "Wipes diagonally from the bottom-right." },
    ],
  },
];

export const TRANSITION_OPTIONS: TransitionOption[] = TRANSITION_GROUPS.flatMap((g) => g.items);

/** Effects rendered with a custom per-pixel expression; slightly slower. */
export const CUSTOM_TRANSITION_IDS = new Set([
  "bloom",
  "burn",
  "glitch",
  "glitchreveal",
  "banding",
  "fire",
  "liquidstreaks",
  "liquiddrops",
  "heart",
  "exchange",
]);

export function transitionLabel(id: string): string {
  return TRANSITION_OPTIONS.find((t) => t.id === id)?.label ?? "Cross fade";
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  showLabel?: boolean;
  className?: string;
}

export default function TransitionPicker({ value, onChange, showLabel = true, className = "" }: Props) {
  const selected = TRANSITION_OPTIONS.find((t) => t.id === value) ?? TRANSITION_OPTIONS[0];

  return (
    <div className={`space-y-1.5 ${className}`}>
      {showLabel && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Transition</span>
          <InfoTip
            text="Applied between adjacent clips. Duration is clamped so it never exceeds the shorter clip. Stylized effects render slower."
            label="Transitions"
          />
        </div>
      )}
      <select
        value={selected.id}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        aria-label="Video transition"
      >
        {TRANSITION_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span>{selected.label}</span>
        {CUSTOM_TRANSITION_IDS.has(selected.id) && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            slower
          </span>
        )}
        <InfoTip text={selected.description} label={selected.label} />
      </div>
    </div>
  );
}
