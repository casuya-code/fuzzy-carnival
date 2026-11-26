/**
 * Shared text style contract used by captions and publish assets.
 * Field names match the backend text_styles.py validator.
 */
export type TextStylePresetId =
  | "default"
  | "creator"
  | "neon"
  | "vintage"
  | "bubble"
  | "cute"
  | "stencil"
  | "boho"
  | "custom";

export type PresetId = Exclude<TextStylePresetId, "custom">;

export interface TextStyle {
  preset: TextStylePresetId;
  font_family: string;
  font_scale: number;
  bold: boolean;
  italic: boolean;
  highlight_color: string;
  base_color: string;
  outline_color: string;
  outline_width: number;
  background_color: string;
  background_opacity: number;
  alignment: "left" | "center" | "right";
  position: "top" | "middle" | "bottom";
  rotation: number;
  letter_spacing: number;
}

export interface LowerThird {
  speaker: string;
  location: string;
  topic: string;
}

export const EMPTY_LOWER_THIRD: LowerThird = { speaker: "", location: "", topic: "" };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  preset: "default",
  font_family: "DejaVu Sans",
  font_scale: 100,
  bold: true,
  italic: false,
  highlight_color: "#FFFF00",
  base_color: "#FFFFFF",
  outline_color: "#000000",
  outline_width: 5,
  background_color: "#000000",
  background_opacity: 0,
  alignment: "center",
  position: "bottom",
  rotation: 0,
  letter_spacing: 0,
};

export const TEXT_STYLE_PRESETS: Record<PresetId, TextStyle> = {
  default: DEFAULT_TEXT_STYLE,
  creator: {
    ...DEFAULT_TEXT_STYLE,
    preset: "creator",
    font_scale: 105,
    highlight_color: "#FFD700",
    outline_width: 6,
    background_opacity: 55,
    letter_spacing: 1,
  },
  neon: {
    ...DEFAULT_TEXT_STYLE,
    preset: "neon",
    font_scale: 108,
    highlight_color: "#00FFFF",
    base_color: "#FF66FF",
    outline_color: "#101020",
    outline_width: 7,
    background_opacity: 65,
    letter_spacing: 2,
  },
  vintage: {
    ...DEFAULT_TEXT_STYLE,
    preset: "vintage",
    font_family: "DejaVu Serif",
    font_scale: 96,
    bold: false,
    highlight_color: "#F4C542",
    base_color: "#F5E6C8",
    outline_color: "#2B1B0E",
    outline_width: 4,
    background_color: "#1A1208",
    background_opacity: 45,
  },
  bubble: {
    ...DEFAULT_TEXT_STYLE,
    preset: "bubble",
    font_scale: 112,
    highlight_color: "#FF7AB8",
    base_color: "#FFFFFF",
    outline_color: "#6A1B4A",
    outline_width: 8,
    background_color: "#FFFFFF",
    background_opacity: 25,
    letter_spacing: 1,
  },
  cute: {
    ...DEFAULT_TEXT_STYLE,
    preset: "cute",
    font_scale: 103,
    highlight_color: "#FFB3C7",
    base_color: "#FFF7D6",
    outline_color: "#5B3A29",
    outline_width: 5,
    background_color: "#FFF0D0",
    background_opacity: 35,
  },
  stencil: {
    ...DEFAULT_TEXT_STYLE,
    preset: "stencil",
    font_family: "DejaVu Sans Mono",
    highlight_color: "#FF5A1F",
    base_color: "#F2F2F2",
    outline_width: 6,
    background_opacity: 60,
    letter_spacing: 3,
  },
  boho: {
    ...DEFAULT_TEXT_STYLE,
    preset: "boho",
    font_family: "DejaVu Serif",
    font_scale: 98,
    bold: false,
    italic: true,
    highlight_color: "#E8B86D",
    base_color: "#F7EFE2",
    outline_color: "#3E2A1E",
    outline_width: 4,
    background_color: "#2A1B12",
    background_opacity: 50,
    letter_spacing: 1,
  },
};

export const PRESET_ORDER: PresetId[] = [
  "default", "creator", "neon", "vintage", "bubble", "cute", "stencil", "boho",
];

export const PRESET_DESCRIPTIONS: Record<PresetId, string> = {
  default: "Current yellow karaoke captions with a black outline.",
  creator: "Gold highlight on a soft dark box for everyday creator videos.",
  neon: "Cyan and magenta glow with a dark backing for music or night scenes.",
  vintage: "Warm serif type with a sepia box for history and heritage stories.",
  bubble: "Rounded pink-and-white look for playful or family clips.",
  cute: "Soft pastel colours with a warm outline for friendly voices.",
  stencil: "Monospaced caps with wide spacing for technical or urgent wording.",
  boho: "Italic serif type in earthy tones for travel and lifestyle videos.",
};

export const FONT_OPTIONS = [
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : fallback;

const color = (value: unknown, fallback: string): string => {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_RE.test(v) ? v : fallback;
};

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** Accepts a stored JSON string or a partial object and returns a safe style. */
export function resolveTextStyle(value: unknown, extraFonts: readonly string[] = []): TextStyle {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TEXT_STYLE };
  const input = raw as Partial<TextStyle>;
  const preset = str(input.preset, "custom") as TextStylePresetId;
  const isKnownPreset = Object.prototype.hasOwnProperty.call(TEXT_STYLE_PRESETS, preset);
  const base = isKnownPreset
    ? TEXT_STYLE_PRESETS[preset as PresetId]
    : DEFAULT_TEXT_STYLE;
  const alignment = str(input.alignment, base.alignment);
  const position = str(input.position, base.position);
  const fontFamily = typeof input.font_family === "string" ? input.font_family.trim().slice(0, 60) : "";
  const customFonts = new Set(
    extraFonts
      .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      .map((name) => name.trim().slice(0, 60))
  );
  const fontAllowed =
    (FONT_OPTIONS as readonly string[]).includes(fontFamily) || customFonts.has(fontFamily);
  return {
    preset: isKnownPreset || preset === "custom" ? preset : "custom",
    font_family: fontAllowed ? fontFamily : base.font_family,
    font_scale: Math.round(clamp(input.font_scale, base.font_scale, 70, 140)),
    bold: bool(input.bold, base.bold),
    italic: bool(input.italic, base.italic),
    highlight_color: color(input.highlight_color, base.highlight_color),
    base_color: color(input.base_color, base.base_color),
    outline_color: color(input.outline_color, base.outline_color),
    outline_width: Math.round(clamp(input.outline_width, base.outline_width, 0, 12)),
    background_color: color(input.background_color, base.background_color),
    background_opacity: Math.round(clamp(input.background_opacity, base.background_opacity, 0, 100)),
    alignment: (["left", "center", "right"] as const).includes(alignment as "left")
      ? (alignment as TextStyle["alignment"])
      : base.alignment,
    position: (["top", "middle", "bottom"] as const).includes(position as "bottom")
      ? (position as TextStyle["position"])
      : base.position,
    rotation: Math.round(clamp(input.rotation, base.rotation, -30, 30)),
    letter_spacing: Math.round(clamp(input.letter_spacing, base.letter_spacing, -10, 20)),
  };
}

export function resolveLowerThird(value: unknown): LowerThird {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  if (!raw || typeof raw !== "object") return { ...EMPTY_LOWER_THIRD };
  const input = raw as Partial<LowerThird>;
  const clean = (v: unknown) =>
    typeof v === "string" ? v.replace(/[{}\\]/g, "").replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "";
  return {
    speaker: clean(input.speaker),
    location: clean(input.location),
    topic: clean(input.topic),
  };
}

export const hasLowerThird = (value: LowerThird): boolean =>
  Boolean(value.speaker || value.location || value.topic);

export const applyPreset = (id: PresetId): TextStyle => ({ ...TEXT_STYLE_PRESETS[id] });

export const withStyleChanges = (
  style: TextStyle,
  changes: Partial<TextStyle>,
  extraFonts: readonly string[] = [],
): TextStyle => resolveTextStyle({ ...style, ...changes, preset: "custom" }, extraFonts);

export function toRgba(hex: string, opacity: number): string {
  const v = HEX_RE.test(hex) ? hex : "#000000";
  const r = parseInt(v.slice(1, 3), 16);
  const g = parseInt(v.slice(3, 5), 16);
  const b = parseInt(v.slice(5, 7), 16);
  const alpha = Math.min(1, Math.max(0, opacity / 100));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS used by the live preview; mirrors the ASS/Pillow rendering options. */
export function stylePreviewCss(style: TextStyle): Record<string, string | number> {
  const shadow = `${Math.max(1, style.outline_width / 2)}px ${Math.max(1, style.outline_width / 2)}px 0 ${style.outline_color}`;
  return {
    color: style.base_color,
    fontFamily: `"${style.font_family}", sans-serif`,
    fontWeight: style.bold ? 800 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    fontSize: `${Math.max(9, Math.min(17, style.font_scale / 8))}px`,
    letterSpacing: `${style.letter_spacing / 5}px`,
    transform: style.rotation ? `rotate(${style.rotation}deg)` : "none",
    textShadow: `${shadow}, -${Math.max(1, style.outline_width / 2)}px -${Math.max(1, style.outline_width / 2)}px 0 ${style.outline_color}`,
    backgroundColor: style.background_opacity > 0
      ? toRgba(style.background_color, style.background_opacity)
      : "transparent",
    textAlign: style.alignment,
  };
}

const STYLE_KEY = "yakodonyo_text_style";
const LOWER_THIRD_KEY = "yakodonyo_lower_third";
const SAVED_PRESETS_KEY = "yakodonyo_saved_text_presets";

export interface SavedTextPreset {
  id: string;
  name: string;
  style: TextStyle;
}

export function loadTextStyle(): TextStyle {
  if (typeof window === "undefined") return { ...DEFAULT_TEXT_STYLE };
  try {
    return resolveTextStyle(window.localStorage.getItem(STYLE_KEY));
  } catch {
    return { ...DEFAULT_TEXT_STYLE };
  }
}

export function saveTextStyle(style: TextStyle): void {
  try {
    window.localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    // Styling still works for this session when storage is unavailable.
  }
}

export function loadLowerThird(): LowerThird {
  if (typeof window === "undefined") return { ...EMPTY_LOWER_THIRD };
  try {
    return resolveLowerThird(window.localStorage.getItem(LOWER_THIRD_KEY));
  } catch {
    return { ...EMPTY_LOWER_THIRD };
  }
}

export function saveLowerThird(value: LowerThird): void {
  try {
    window.localStorage.setItem(LOWER_THIRD_KEY, JSON.stringify(resolveLowerThird(value)));
  } catch {
    // Labels still work for this session when storage is unavailable.
  }
}

export function styleToFormValue(style: TextStyle): string {
  return JSON.stringify(resolveTextStyle(style));
}

export function lowerThirdToFormValue(value: LowerThird): string {
  return JSON.stringify(resolveLowerThird(value));
}

function savedPresetId(): string {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadSavedTextPresets(): SavedTextPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const p = item as Partial<SavedTextPreset>;
      const name = typeof p.name === "string" ? p.name.trim().slice(0, 24) : "";
      if (!name) return [];
      return [{
        id: typeof p.id === "string" && p.id ? p.id : savedPresetId(),
        name,
        style: resolveTextStyle(p.style),
      }];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function saveTextPreset(name: string, style: TextStyle): SavedTextPreset[] {
  const clean = name.trim().slice(0, 24);
  if (!clean) return loadSavedTextPresets();
  const next: SavedTextPreset = { id: savedPresetId(), name: clean, style: resolveTextStyle(style) };
  const list = [next, ...loadSavedTextPresets().filter((p) => p.name.toLowerCase() !== clean.toLowerCase())].slice(0, 12);
  try { window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(list)); } catch { /* best-effort */ }
  return list;
}

export function deleteTextPreset(id: string): SavedTextPreset[] {
  const list = loadSavedTextPresets().filter((p) => p.id !== id);
  try { window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(list)); } catch { /* best-effort */ }
  return list;
}

export function sameTextStyle(a: TextStyle, b: TextStyle): boolean {
  const keys: (keyof TextStyle)[] = [
    "font_family", "font_scale", "bold", "italic", "highlight_color", "base_color",
    "outline_color", "outline_width", "background_color", "background_opacity",
    "alignment", "position", "rotation", "letter_spacing",
  ];
  return keys.every((k) => a[k] === b[k]);
}

const BRAND_FONT_KEY = "yako.brandFont.v1";

export interface BrandFont {
  font_path: string;
  font_name: string;
}

export function loadBrandFont(): BrandFont | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_FONT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (typeof parsed?.font_path === "string" && typeof parsed?.font_name === "string") {
      return { font_path: parsed.font_path, font_name: parsed.font_name };
    }
  } catch { /* ignore */ }
  return null;
}

export function saveBrandFont(font: BrandFont): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(BRAND_FONT_KEY, JSON.stringify(font)); } catch { /* ignore */ }
}

export function clearBrandFont(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(BRAND_FONT_KEY); } catch { /* ignore */ }
}
