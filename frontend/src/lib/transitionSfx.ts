/** Short, locally generated sounds placed on video transition boundaries. */
export type SfxId = "off" | "whoosh" | "pop" | "click" | "lift";

export interface SfxOption {
  id: SfxId;
  label: string;
  tip: string;
}

export const DEFAULT_SFX: SfxId = "off";
export const DEFAULT_SFX_LEVEL = 40;

export const SFX_OPTIONS: SfxOption[] = [
  { id: "off", label: "Off", tip: "No transition sound." },
  { id: "whoosh", label: "Whoosh", tip: "Airy sweep made locally for wipes and pushes." },
  { id: "pop", label: "Pop", tip: "Short soft pop made locally for playful cuts." },
  { id: "click", label: "Click", tip: "Tight tick made locally for glitches and hard cuts." },
  { id: "lift", label: "Lift", tip: "Rising two-note swell made locally for reveals." },
];
