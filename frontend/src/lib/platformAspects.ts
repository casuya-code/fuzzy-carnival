/** Platform-facing names for the existing aspect-ratio contract. */
export type AspectRatio = "9:16" | "1:1" | "16:9";

export interface PlatformAspect {
  ratio: AspectRatio;
  label: string;
  tip: string;
}

export const PLATFORM_ASPECTS: PlatformAspect[] = [
  { ratio: "9:16", label: "Shorts", tip: "TikTok, Reels and Shorts — 1080×1920." },
  { ratio: "1:1", label: "Feed", tip: "Instagram and Facebook feed — 1080×1080." },
  { ratio: "16:9", label: "YouTube", tip: "YouTube landscape — 1920×1080." },
];
