"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { uploadBrandFont } from "@/lib/api";
import {
  applyPreset,
  clearBrandFont,
  deleteTextPreset,
  FONT_OPTIONS,
  loadBrandFont,
  loadSavedTextPresets,
  PRESET_DESCRIPTIONS,
  PRESET_ORDER,
  sameTextStyle,
  saveBrandFont,
  saveTextPreset,
  type BrandFont,
  type SavedTextPreset,
  type TextStyle,
  withStyleChanges,
} from "@/lib/textStyles";

interface Props {
  value: TextStyle;
  onChange: (style: TextStyle) => void;
  defaultOpen?: boolean;
}

const ALIGNMENTS = ["left", "center", "right"] as const;
const POSITIONS = ["top", "middle", "bottom"] as const;

/** Short controls for the shared caption/title style model. */
export default function TextStylePicker({ value, onChange, defaultOpen = true }: Props) {
  const [saved, setSaved] = useState<SavedTextPreset[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [brandFont, setBrandFont] = useState<BrandFont | null>(null);
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  useEffect(() => { setSaved(loadSavedTextPresets()); setBrandFont(loadBrandFont()); }, []);

  const update = (changes: Parameters<typeof withStyleChanges>[1]) =>
    onChange(withStyleChanges(value, changes));

  const applySaved = (preset: SavedTextPreset) => {
    onChange({ ...preset.style, preset: "custom" });
  };

  const saveCurrent = () => {
    const name = saveName.trim().slice(0, 24);
    if (!name) return;
    setSaved(saveTextPreset(name, value));
    setSaveName("");
    setSaving(false);
  };

  const removeSaved = (id: string) => {
    setSaved(deleteTextPreset(id));
  };

  const onFontUpload = async (file: File | null) => {
    if (!file) return;
    setFontBusy(true);
    setFontError(null);
    try {
      const r = await uploadBrandFont(file);
      const bf = { font_path: r.font_path, font_name: r.font_name || file.name.replace(/\.[^.]+$/, "") };
      saveBrandFont(bf);
      setBrandFont(bf);
      update({ font_family: bf.font_name });
    } catch (e: any) {
      setFontError(e?.message || "Font upload failed");
    } finally {
      setFontBusy(false);
    }
  };

  const onClearBrandFont = () => {
    clearBrandFont();
    setBrandFont(null);
    if (brandFont && value.font_family === brandFont.font_name) update({ font_family: FONT_OPTIONS[0] });
  };

  return (
    <details open={defaultOpen} className="rounded-lg border bg-gray-50 p-3">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Text style <InfoTip text="Presets and small controls shared by captions, titles, thumbnails and Shorts." label="Text style" />
      </summary>

      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(applyPreset(id))}
              className={`rounded-full border px-2 py-1 text-[11px] font-medium capitalize transition ${
                value.preset === id
                  ? "border-purple-500 bg-purple-600 text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-white"
              }`}
            >
              {id}
              <InfoTip text={PRESET_DESCRIPTIONS[id]} label={`${id} style`} focusable={false} />
            </button>
          ))}
          {value.preset === "custom" && (
            <span className="rounded-full bg-gray-200 px-2 py-1 text-[10px] text-gray-600">custom</span>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-400">
            Saved <InfoTip text="Save your current style on this device. Saved presets appear here and can be reused." label="Saved presets" focusable={false} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {saved.map((preset) => {
              const active = sameTextStyle(value, preset.style);
              return (
                <span key={preset.id} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => applySaved(preset)}
                    className={`rounded-full border px-2 py-1 text-[11px] font-medium transition ${
                      active ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-white"
                    }`}
                    title={preset.name}
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSaved(preset.id)}
                    className="rounded px-1 text-[11px] text-gray-400 hover:text-red-500"
                    aria-label={`Delete ${preset.name}`}
                    title="Delete"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {!saving ? (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="rounded-full border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-600"
              >
                ＋ Save
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveCurrent(); } if (e.key === "Escape") { setSaving(false); setSaveName(""); } }}
                  placeholder="Name"
                  maxLength={24}
                  className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700"
                  aria-label="Preset name"
                  autoFocus
                />
                <button type="button" onClick={saveCurrent} disabled={!saveName.trim()} className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white disabled:opacity-40">Save</button>
                <button type="button" onClick={() => { setSaving(false); setSaveName(""); }} className="rounded border px-2 py-1 text-[11px] text-gray-500">Cancel</button>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Font
            <select
              value={
                FONT_OPTIONS.includes(value.font_family as (typeof FONT_OPTIONS)[number]) || value.font_family === brandFont?.font_name
                  ? value.font_family
                  : FONT_OPTIONS[0]
              }
              onChange={(e) => update({ font_family: e.target.value })}
              className="w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-[11px] normal-case text-gray-700"
            >
              {brandFont && <option value={brandFont.font_name}>{brandFont.font_name} (brand)</option>}
              {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.replace("DejaVu ", "")}</option>)}
            </select>
            <div className="mt-1 flex items-center gap-1 normal-case">
              <label className="cursor-pointer rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100">
                {fontBusy ? "Uploading…" : "Upload font"}
                <input type="file" accept=".ttf,.otf,font/ttf,font/otf" className="hidden" disabled={fontBusy} onChange={(e) => { void onFontUpload(e.target.files?.[0] || null); e.target.value = ""; }} />
              </label>
              {brandFont && <button type="button" onClick={onClearBrandFont} className="text-[10px] text-red-500 hover:underline">Clear</button>}
            </div>
            {fontError && <div className="text-[10px] normal-case text-red-600">{fontError}</div>}
          </label>

          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Size <InfoTip text="Scales the safe-zone font size; 100% keeps the current caption size." label="Font size" focusable={false} />
            <div className="flex items-center gap-1">
              <input type="range" min={70} max={140} step={1} value={value.font_scale} onChange={(e) => update({ font_scale: parseInt(e.target.value) })} className="w-full accent-purple-600" />
              <span className="w-8 text-right font-mono text-[10px] normal-case text-gray-600">{value.font_scale}%</span>
            </div>
          </label>

          <div className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Emphasis
            <div className="flex gap-1">
              <button type="button" onClick={() => update({ bold: !value.bold })} className={`h-7 w-8 rounded border text-xs font-bold ${value.bold ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-500"}`} title="Bold">B</button>
              <button type="button" onClick={() => update({ italic: !value.italic })} className={`h-7 w-8 rounded border text-xs italic ${value.italic ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-500"}`} title="Italic">I</button>
            </div>
          </div>

          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Active
            <input type="color" value={value.highlight_color} onChange={(e) => update({ highlight_color: e.target.value })} className="h-7 w-full rounded border border-gray-300 bg-white p-0.5" />
          </label>
          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Base
            <input type="color" value={value.base_color} onChange={(e) => update({ base_color: e.target.value })} className="h-7 w-full rounded border border-gray-300 bg-white p-0.5" />
          </label>
          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Outline
            <span className="flex items-center gap-1">
              <input type="color" value={value.outline_color} onChange={(e) => update({ outline_color: e.target.value })} className="h-7 w-9 rounded border border-gray-300 bg-white p-0.5" />
              <input type="range" min={0} max={12} value={value.outline_width} onChange={(e) => update({ outline_width: parseInt(e.target.value) })} className="w-full accent-gray-700" />
            </span>
          </label>

          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Box <InfoTip text="Optional solid backing behind the text. 0 leaves the current transparent style." label="Text background" focusable={false} />
            <span className="flex items-center gap-1">
              <input type="color" value={value.background_color} onChange={(e) => update({ background_color: e.target.value })} className="h-7 w-9 rounded border border-gray-300 bg-white p-0.5" />
              <input type="range" min={0} max={100} value={value.background_opacity} onChange={(e) => update({ background_opacity: parseInt(e.target.value) })} className="w-full accent-blue-600" />
            </span>
          </label>

          <div className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Align
            <div className="grid grid-cols-3 gap-1">
              {ALIGNMENTS.map((a) => (
                <button key={a} type="button" onClick={() => update({ alignment: a })} className={`rounded border py-1 text-[10px] normal-case ${value.alignment === a ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-500"}`}>{a}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Place
            <div className="grid grid-cols-3 gap-1">
              {POSITIONS.map((p) => (
                <button key={p} type="button" onClick={() => update({ position: p })} className={`rounded border py-1 text-[10px] normal-case ${value.position === p ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-500"}`}>{p}</button>
              ))}
            </div>
          </div>

          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Rotate
            <input type="range" min={-30} max={30} value={value.rotation} onChange={(e) => update({ rotation: parseInt(e.target.value) })} className="w-full accent-amber-600" />
          </label>
          <label className="space-y-1 text-[10px] uppercase tracking-wide text-gray-400">
            Spacing
            <input type="range" min={-10} max={20} value={value.letter_spacing} onChange={(e) => update({ letter_spacing: parseInt(e.target.value) })} className="w-full accent-amber-600" />
          </label>
        </div>
      </div>
    </details>
  );
}