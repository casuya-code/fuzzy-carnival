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
      setRegenError(e?.message || "Regenerate failed");
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
      setRenderError(e?.message || "Render failed");
    } finally {
      setRendering(false);
    }
  };

  if (!result) {
    return (
      <section className="rounded-xl border border-dashed bg-white p-6 sm:p-8 text-center shadow-sm">
        <div className="text-sm text-gray-400">∅ &nbsp; Output matrix empty — generate audio to populate.</div>
        <div className="mt-1 text-[11px] font-mono text-gray-300">y → awaiting synthesis</div>
      </section>
    );
  }

  const filename = `voice-clone-${result.engine_used}-${result.audio_r2_key.split("/").pop()}`;
  const resultId = result.audio_r2_key.split("/").pop() || "audio";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2 border-b pb-2 flex-wrap">
          <h3 className="text-base sm:text-lg font-semibold">④ Output</h3>
          <div className="flex items-center gap-1.5 flex-wrap">
            {lastReq && (
              <button
                onClick={newTake}
                disabled={regenLoading}
                className="rounded-md border border-purple-300 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50"
                title="Generate a fresh variation (bypasses cache)"
              >
                {regenLoading ? "…" : "🎲 New take"}
              </button>
            )}
            <button
              onClick={copyUrl}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50"
            >
              {copied ? "Copied!" : "Copy URL"}
            </button>
            <a
              href={result.audio_url}
              download={filename}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
            >
              ⬇ Download
            </a>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Property</th>
                <th className="px-3 py-2 text-left font-semibold">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-white">
                <td className="px-3 py-2 font-mono text-gray-500">engine</td>
                <td className="px-3 py-2 font-medium text-gray-800">{result.engine_used}</td>
              </tr>
              <tr className="bg-gray-50/40">
                <td className="px-3 py-2 font-mono text-gray-500">duration (T)</td>
                <td className="px-3 py-2 font-mono tabular-nums text-gray-800">{result.duration_seconds ? `${result.duration_seconds.toFixed(2)} s` : "n/a"}</td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2 font-mono text-gray-500">id</td>
                <td className="px-3 py-2 font-mono text-gray-600 truncate max-w-[12rem] sm:max-w-none" title={resultId}>{resultId}</td>
              </tr>
              <tr className="bg-gray-50/40">
                <td className="px-3 py-2 font-mono text-gray-500">rate</td>
                <td className="px-3 py-2">
                  <div className="inline-flex overflow-hidden rounded-md border">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setRate(s)}
                        className={`px-2.5 py-1 text-xs font-mono transition ${speed === s ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <audio
          key={result.audio_url}
          ref={audioRef}
          controls
          src={result.audio_url}
          className="w-full h-10"
          autoPlay
          onLoadedMetadata={onLoaded}
        />

        <div className="rounded-lg border bg-gray-50/40 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Render export (tempo/volume)</div>
            <span className="text-[11px] font-mono text-gray-400">ffmpeg · pitch-preserving speed</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs sm:text-sm">
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-3 font-mono text-gray-500 w-20">speed</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((s) => (
                        <button key={s} type="button" onClick={() => setExportSpeed(s)} className={`rounded border px-2 py-0.5 font-mono transition ${exportSpeed === s ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{s}x</button>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-mono text-gray-500">gain</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[{v:0.7,l:"-3dB"},{v:1,l:"0dB"},{v:1.25,l:"+2dB"},{v:1.4,l:"+3dB"}].map((g) => (
                        <button key={g.l} type="button" onClick={() => setExportVolume(g.v)} className={`rounded border px-2 py-0.5 font-mono transition ${Math.abs(exportVolume-g.v)<0.01 ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{g.l}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={renderExport} disabled={rendering} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {rendering ? "Rendering…" : "⬇ Render & Download MP3"}
            </button>
            <span className="text-[11px] font-mono text-gray-400">speed={exportSpeed}x · gain={exportVolume.toFixed(2)}</span>
          </div>
          {renderError && <p className="text-xs text-red-600">{renderError}</p>}
          {rendered && (
            <div className="rounded-md border bg-white p-2 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <span className="font-medium text-green-700">Rendered export ready</span>
                {rendered.duration_seconds ? <span className="font-mono text-gray-500">T={rendered.duration_seconds.toFixed(2)}s</span> : null}
              </div>
              <audio controls src={rendered.audio_url} className="w-full h-8" />
              <a href={rendered.audio_url} download={`render-${exportSpeed}x-${resultId}.mp3`} className="inline-block rounded-md border border-gray-300 px-2.5 py-1 text-[11px] text-gray-700 hover:bg-gray-100">Save rendered MP3</a>
            </div>
          )}
        </div>

        {regenError && <p className="text-xs text-red-600">{regenError}</p>}
      </section>

      {history.length > 1 && (
        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <h4 className="text-sm font-semibold">Output History</h4>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-mono text-gray-600">n = {history.length}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold w-10">#</th>
                  <th className="px-3 py-2 text-left font-semibold">Engine</th>
                  <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">ID</th>
                  <th className="px-3 py-2 text-right font-semibold">T</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h, i) => {
                  const active = h.audio_url === result.audio_url;
                  const id = h.audio_r2_key.split("/").pop() || String(i);
                  return (
                    <tr
                      key={h.audio_url}
                      onClick={() => onSelect?.(h)}
                      className={`cursor-pointer transition ${active ? "bg-blue-50" : i % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50/40 hover:bg-gray-50"}`}
                    >
                      <td className="px-3 py-2 font-mono text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {h.engine_used}
                        {active ? <span className="ml-1.5 text-[10px] font-mono text-blue-600">● active</span> : null}
                        <div className="sm:hidden text-[11px] font-mono text-gray-400 truncate max-w-[10rem]">{id.slice(0, 12)}</div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell font-mono text-[11px] text-gray-500 truncate max-w-[10rem]" title={id}>{id.slice(0, 14)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">{h.duration_seconds ? `${h.duration_seconds.toFixed(1)}s` : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          <a
                            href={h.audio_url}
                            download={`voice-clone-${h.engine_used}-${id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-block rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                          >
                            Save
                          </a>
                          {onRemove && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRemove(h.audio_url); }}
                              className="inline-block rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}