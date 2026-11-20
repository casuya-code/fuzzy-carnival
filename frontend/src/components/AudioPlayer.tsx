"use client";

import { useEffect, useRef, useState } from "react";
import { SynthesizeResponse, SynthesizeRequest, synthesize, transformAudio } from "@/lib/api";

interface Props {
  result: SynthesizeResponse | null;
  history?: SynthesizeResponse[];
  onSelect?: (r: SynthesizeResponse) => void;
  lastReq?: SynthesizeRequest | null;
  onRegenerated?: (res: SynthesizeResponse, req: SynthesizeRequest) => void;
  onRemove?: (url: string) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5];

const engineLabel: Record<string, string> = {
  kyutai: "English Voice Clone",
  afrispeech: "English (African Accent)",
  msingi: "Swahili Voice Clone",
  mms: "Swahili (Basic Voice)",
  azure: "Swahili Natural Voice",
  elevenlabs: "Expressive Voice (Online)",
};

export default function AudioPlayer({ result, history = [], onSelect, lastReq, onRegenerated, onRemove }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportSpeed, setExportSpeed] = useState(1);
  const [exportVolume, setExportVolume] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ audio_url: string; audio_r2_key?: string; duration_seconds?: number } | null>(null);

  useEffect(() => {
    setRendered(null);
    setRenderError(null);
  }, [result?.audio_url]);

  const setRate = (r: number) => {
    setSpeed(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  const onLoaded = () => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  };

  const copyUrl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.audio_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const newTake = async () => {
    if (!lastReq || regenLoading) return;
    setRegenLoading(true);
    setRegenError(null);
    try {
      const req: SynthesizeRequest = { ...lastReq, skip_cache: true };
      const res = await synthesize(req);
      onRegenerated?.(res, lastReq);
    } catch (e: any) {
      setRegenError(e?.message || "Could not create another version.");
    } finally {
      setRegenLoading(false);
    }
  };

  const renderExport = async () => {
    if (!result || rendering) return;
    setRendering(true);
    setRenderError(null);
    try {
      const res = await transformAudio({
        audio_r2_key: result.audio_r2_key,
        speed: exportSpeed,
        volume: exportVolume,
        output_format: "mp3",
      });
      setRendered(res);
    } catch (e: any) {
      setRenderError(e?.message || "Could not prepare the download.");
    } finally {
      setRendering(false);
    }
  };

  if (!result) {
    return (
      <section className="rounded-xl border border-dashed bg-white p-6 sm:p-8 text-center shadow-sm">
        <div className="text-base font-medium text-gray-700">Your audio will appear here</div>
        <div className="mt-2 text-sm text-gray-500">Write your text in Step 3 and click <span className="font-medium">Create speech</span>.</div>
      </section>
    );
  }

  const filenameBase = `speech-${result.engine_used}-${(result.audio_r2_key.split("/").pop() || "audio").replace(/\.[^.]+$/, "")}`;
  const friendlyEngine = engineLabel[result.engine_used] || result.engine_used;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3 border-b pb-3 flex-wrap">
          <div>
            <h3 className="text-base sm:text-lg font-semibold">Your audio</h3>
            <p className="mt-1 text-sm text-gray-600">Listen, download, or create another version.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {lastReq && (
              <button
                onClick={newTake}
                disabled={regenLoading}
                className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50"
                title="Create a fresh version with the same settings"
              >
                {regenLoading ? "Creating..." : "Try another version"}
              </button>
            )}
            <button
              onClick={copyUrl}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a
              href={result.audio_url}
              download={`${filenameBase}.mp3`}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Download audio
            </a>
          </div>
        </div>

        {result.warning && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>Note:</strong> {result.warning}
          </div>
        )}

        <div className="rounded-lg border bg-gray-50/60 p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Voice used</div>
            <div className="mt-0.5 font-medium text-gray-900">{friendlyEngine}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Length</div>
            <div className="mt-0.5 font-medium text-gray-900">{result.duration_seconds ? `${result.duration_seconds.toFixed(1)} seconds` : "Not available"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Playback speed</div>
            <div className="mt-1 inline-flex overflow-hidden rounded-lg border bg-white">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRate(s)}
                  className={`px-3 py-1 text-sm transition ${speed === s ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-50"}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <audio
          key={result.audio_url}
          ref={audioRef}
          controls
          src={result.audio_url}
          className="w-full h-11"
          autoPlay
          onLoadedMetadata={onLoaded}
        />

        <div className="rounded-lg border bg-gray-50/40 p-3 sm:p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Make a downloadable version</div>
            <p className="mt-1 text-sm text-gray-600">Adjust speed and volume, then create a new MP3 file to download.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Speed</div>
              <div className="flex flex-wrap gap-1.5">
                {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExportSpeed(s)}
                    className={`rounded-md border px-2.5 py-1 text-sm transition ${exportSpeed === s ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    {s === 1 ? "Normal (1x)" : `${s}x`}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Volume</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 0.7, l: "Quieter" },
                  { v: 1, l: "Normal" },
                  { v: 1.25, l: "Louder" },
                  { v: 1.4, l: "Loudest" },
                ].map((g) => (
                  <button
                    key={g.l}
                    type="button"
                    onClick={() => setExportVolume(g.v)}
                    className={`rounded-md border px-2.5 py-1 text-sm transition ${Math.abs(exportVolume - g.v) < 0.01 ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    {g.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={renderExport}
              disabled={rendering}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {rendering ? "Preparing download..." : "Prepare downloadable MP3"}
            </button>
            <span className="text-xs text-gray-500">Speed {exportSpeed}x · Volume {exportVolume === 1 ? "normal" : exportVolume < 1 ? "quieter" : "louder"}</span>
          </div>

          {renderError && <p className="text-sm text-red-600">{renderError}</p>}
          {rendered && (
            <div className="rounded-lg border bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
                <span className="font-medium text-green-700">Downloadable version is ready</span>
                {rendered.duration_seconds ? <span className="text-gray-500">{rendered.duration_seconds.toFixed(1)} seconds</span> : null}
              </div>
              <audio controls src={rendered.audio_url} className="w-full h-9" />
              <a
                href={rendered.audio_url}
                download={`${filenameBase}-${exportSpeed}x.mp3`}
                className="inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Download this version
              </a>
            </div>
          )}
        </div>

        {regenError && <p className="text-sm text-red-600">{regenError}</p>}
      </section>

      {history.length > 1 && (
        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <h4 className="text-base font-semibold">Recent versions</h4>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{history.length} saved</span>
          </div>
          <div className="space-y-2">
            {history.map((h, i) => {
              const active = h.audio_url === result.audio_url;
              const name = engineLabel[h.engine_used] || h.engine_used;
              return (
                <div
                  key={h.audio_url}
                  onClick={() => onSelect?.(h)}
                  className={`rounded-lg border p-3 cursor-pointer transition ${active ? "border-blue-400 bg-blue-50/50" : "border-gray-200 hover:bg-gray-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{name}</span>
                        {active && <span className="text-xs font-medium text-blue-700">Now playing</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-gray-600">
                        {h.duration_seconds ? `${h.duration_seconds.toFixed(1)} seconds` : "Audio"} · Version {i + 1}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={h.audio_url}
                        download={`${filenameBase}-v${i + 1}.mp3`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs sm:text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Download
                      </a>
                      {onRemove && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemove(h.audio_url); }}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs sm:text-sm text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
