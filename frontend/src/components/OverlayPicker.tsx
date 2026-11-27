"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/InfoTip";
import {
  DEFAULT_OVERLAY_SIZE,
  OVERLAY_ACCEPT,
  OVERLAY_POSITIONS,
  type OverlayPosition,
} from "@/lib/localOverlay";

interface Props {
  file: File | null;
  position: OverlayPosition;
  size: number;
  opacity: number;
  onFileChange: (file: File | null) => void;
  onPositionChange: (position: OverlayPosition) => void;
  onSizeChange: (size: number) => void;
  onOpacityChange: (opacity: number) => void;
}

/** Compact local-image overlay controls; explanations live in the tips. */
export default function OverlayPicker({
  file,
  position,
  size,
  opacity,
  onFileChange,
  onPositionChange,
  onSizeChange,
  onOpacityChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
        Overlay
        <InfoTip
          label="Local overlay"
          text="Add your own logo or badge. The image stays on your device until render; no stock library or upload catalog is used."
        />
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={OVERLAY_ACCEPT}
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] || null)}
        aria-label="Overlay image"
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-lg border p-2">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Overlay preview" loading="lazy" decoding="async" className="h-12 w-12 rounded bg-gray-100 object-contain" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-gray-800" title={file.name}>{file.name}</div>
            <div className="text-[11px] text-gray-400">
              Ready to burn in
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border-2 border-dashed border-gray-300 p-3 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50"
        >
          ＋ Add image <InfoTip label="Overlay formats" text="PNG, JPG or WebP up to 10 MB. PNG keeps transparency." focusable={false} />
        </button>
      )}

      {file && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
              Place
              <InfoTip label="Overlay place" text="Corners stay clear of center captions. Center is best for a small logo." />
            </span>
            <select
              value={position}
              onChange={(e) => onPositionChange(e.target.value as OverlayPosition)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              aria-label="Overlay place"
            >
              {OVERLAY_POSITIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
              Size
              <InfoTip label="Overlay size" text={`Width as a share of the frame (8–40%). Default ${DEFAULT_OVERLAY_SIZE}%. Tall images are capped.`} />
            </span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={8}
                max={40}
                step={1}
                value={size}
                onChange={(e) => onSizeChange(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
              <span className="w-8 text-right font-mono text-[11px] tabular-nums">{size}%</span>
            </span>
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
              Opacity
              <InfoTip label="Overlay opacity" text="Lower values make a softer watermark. Range is 10–100%." />
            </span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={opacity}
                onChange={(e) => onOpacityChange(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
              <span className="w-8 text-right font-mono text-[11px] tabular-nums">{opacity}%</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
