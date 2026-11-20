"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { mixAudio, uploadLocalBlob } from "@/lib/api";
import { fmtSize } from "@/lib/format";
import {
  addSpeechHistory,
  loadSpeechHistory,
  removeSpeechHistory,
  SpeechHistoryItem,
} from "@/lib/history";

// ---------- IndexedDB helpers for uploaded audio layers ----------
const DB_NAME = "sb-music-db";
const STORE = "tracks";
const DB_VERSION = 2;

type TrackKind = "music" | "ambient";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: "id" });
      } else {
        store = req.transaction!.objectStore(STORE);
      }
      // Backfill kind for existing records (v1 -> v2)
      if (ev.oldVersion < 2 && ev.oldVersion > 0) {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const val = cursor.value as any;
            if (!val.kind) {
              val.kind = "music";
              cursor.update(val);
            }
            cursor.continue();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface AudioTrack {
  id: string;
  name: string;
  kind: TrackKind;
  type: string;
  blob: Blob;
  addedAt: number;
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

function trackExtension(track: AudioTrack): string {
  return AUDIO_EXTENSIONS[track.type?.toLowerCase()] || "mp3";
}

async function listTracks(): Promise<AudioTrack[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as any[]).map((r) => ({ ...r, kind: r.kind || "music" })) as AudioTrack[];
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveTrack(track: AudioTrack): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(track);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteTrack(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export default function SpeechAndBackgroundPage() {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<TrackKind>("music");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [speeches, setSpeeches] = useState<SpeechHistoryItem[]>([]);

  // Merge settings (3-layer stack)
  const [selectedSpeech, setSelectedSpeech] = useState<string>("");
  const [selectedAmbient, setSelectedAmbient] = useState<string>("");
  const [selectedMusic, setSelectedMusic] = useState<string>("");
  const [ambientVolume, setAmbientVolume] = useState(0.08);
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [introMs, setIntroMs] = useState(1500);
  const [outroSec, setOutroSec] = useState(2.5);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ audio_r2_key?: string; audio_url: string; duration_seconds?: number } | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const refreshTracks = useCallback(async () => {
    try {
      const t = await listTracks();
      setTracks(t.sort((a, b) => b.addedAt - a.addedAt));
    } catch (e: any) {
      setError(e?.message || "Failed to load library");
    }
  }, []);

  useEffect(() => {
    refreshTracks();
    setSpeeches(loadSpeechHistory());
  }, [refreshTracks]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const ambientTracks = tracks.filter((t) => t.kind === "ambient");
  const musicTracks = tracks.filter((t) => t.kind === "music");

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose an audio file first.");
      return;
    }
    const trackName = name.trim() || file.name.replace(/\.[^.]+$/, "");
    setUploading(true);
    try {
      const track: AudioTrack = {
        id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trackName,
        kind,
        type: file.type || "audio/mpeg",
        blob: file,
        addedAt: Date.now(),
      };
      await saveTrack(track);
      setName("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshTracks();
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this track?")) return;
    try {
      await deleteTrack(id);
      if (playingId === id) {
        audioRef.current?.pause();
        setPlayingId(null);
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      }
      await refreshTracks();
      if (selectedMusic === id) setSelectedMusic("");
      if (selectedAmbient === id) setSelectedAmbient("");
    } catch (err: any) {
      setError(err?.message || "Delete failed");
    }
  };

  const resetMerge = () => {
    setSelectedSpeech("");
    setSelectedAmbient("");
    setSelectedMusic("");
    setAmbientVolume(0.08);
    setMusicVolume(0.18);
    setIntroMs(1500);
    setOutroSec(2.5);
    setMergeResult(null);
    setMergeError(null);
  };

  const handlePlay = (track: AudioTrack) => {
    if (!audioRef.current) return;
    if (playingId === track.id) {
      audioRef.current.pause();
      setPlayingId(null);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      return;
    }
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(track.blob);
    blobUrlRef.current = url;
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
    setPlayingId(track.id);
  };

  const handleDeleteSpeech = (url: string) => {
    if (!confirm("Remove this speech from the list?")) return;
    setSpeeches(removeSpeechHistory(url));
    if (selectedSpeech === url) setSelectedSpeech("");
  };

  const uploadTrackToBackend = async (track: AudioTrack) => {
    const ext = trackExtension(track);
    const key = `audio_library/${track.id}.${ext}`;
    return uploadLocalBlob(key, track.blob, track.type || `audio/${ext}`);
  };

  const handleMerge = async () => {
    setMergeError(null);
    setMergeResult(null);
    if (!selectedSpeech) { setMergeError("Select a speech (Layer 1) first."); return; }

    const speech = speeches.find((s) => s.audio_url === selectedSpeech);
    const music = tracks.find((t) => t.id === selectedMusic);
    const ambient = tracks.find((t) => t.id === selectedAmbient);
    if (!speech) { setMergeError("Speech selection not found."); return; }

    setMerging(true);
    try {
      let musicKey: string | null = null;
      let ambientKey: string | null = null;
      if (music) musicKey = await uploadTrackToBackend(music);
      if (ambient) ambientKey = await uploadTrackToBackend(ambient);

      const res = await mixAudio({
        voice_r2_key: speech.audio_r2_key,
        music_r2_key: musicKey,
        music_volume: musicVolume,
        ambient_r2_key: ambientKey,
        ambient_volume: ambientVolume,
        intro_ms: introMs,
        outro_sec: outroSec,
      });
      setMergeResult(res);
      // Persist mixed/mastered output so it can be reused (e.g. in Trimming & Zooming)
      if (res.audio_r2_key) {
        const layers = ["L1", selectedAmbient ? "L2" : null, selectedMusic ? "L3" : null]
          .filter(Boolean)
          .join("⊕");
        const entry: SpeechHistoryItem = {
          audio_r2_key: res.audio_r2_key,
          audio_url: res.audio_url,
          engine_used: layers === "L1" ? "mastered (L1)" : `mixed (${layers})`,
          duration_seconds: res.duration_seconds,
        };
        setSpeeches(addSpeechHistory(entry));
      }
    } catch (e: any) {
      setMergeError(e?.message || "Mix failed");
    } finally {
      setMerging(false);
    }
  };

  const renderTrackTable = (items: AudioTrack[], layerLabel: string, emptyText: string) => (
    items.length === 0 ? (
      <div className="rounded-lg border border-dashed p-5 text-center text-sm text-gray-400">
        ∅ &nbsp; {emptyText}
      </div>
    ) : (
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-10">#</th>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Meta</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((t, i) => (
              <tr key={t.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                <td className="px-3 py-2 font-mono text-gray-400 tabular-nums">{i + 1}</td>
                <td className="px-3 py-2 max-w-[10rem] sm:max-w-[14rem]">
                  <div className="truncate font-medium text-gray-800" title={t.name}>{t.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{layerLabel}</div>
                  <div className="text-[11px] text-gray-400 sm:hidden font-mono">
                    {fmtSize(t.blob.size)} · {new Date(t.addedAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-3 py-2 hidden sm:table-cell text-[11px] text-gray-500 font-mono whitespace-nowrap">
                  <div>{t.type || "audio"}</div>
                  <div>{fmtSize(t.blob.size)} · {new Date(t.addedAt).toLocaleDateString()}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5 flex-wrap">
                    <button
                      onClick={() => handlePlay(t)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${playingId === t.id ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
                    >
                      {playingId === t.id ? "⏹ Stop" : "▶ Play"}
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  const ready = !!selectedSpeech;

  const presets: { id: string; label: string; v2: number; v3: number; tin: number; tout: number }[] = [
    { id: "podcast", label: "Podcast", v2: 0.04, v3: 0.12, tin: 800, tout: 1.5 },
    { id: "documentary", label: "Documentary", v2: 0.08, v3: 0.16, tin: 1500, tout: 2.5 },
    { id: "cinematic", label: "Cinematic", v2: 0.10, v3: 0.20, tin: 2000, tout: 3.0 },
    { id: "ambient", label: "Ambient-heavy", v2: 0.14, v3: 0.10, tin: 1500, tout: 3.0 },
    { id: "upbeat", label: "Upbeat", v2: 0.05, v3: 0.22, tin: 600, tout: 1.5 },
    { id: "subtle", label: "Subtle", v2: 0.03, v3: 0.10, tin: 1000, tout: 2.0 },
  ];

  const applyPreset = (p: typeof presets[number]) => {
    setAmbientVolume(p.v2);
    setMusicVolume(p.v3);
    setIntroMs(p.tin);
    setOutroSec(p.tout);
  };

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🎵 Add Music &amp; Sounds</h1>
          <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
            Mix your voice with background sounds and music. Keep your voice clear and choose how loud each extra track should be.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Layer</th>
                <th className="px-3 py-2 text-left font-semibold">Role</th>
                <th className="px-3 py-2 text-left font-semibold">Processing</th>
                <th className="px-3 py-2 text-right font-semibold">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-white">
                <td className="px-3 py-2 font-mono font-semibold text-gray-800">L1</td>
                <td className="px-3 py-2">Cloned voiceover (EN/SW)</td>
                <td className="px-3 py-2 text-gray-600">Foreground, clear & upfront</td>
                <td className="px-3 py-2 text-right font-mono">~ −16 LUFS</td>
              </tr>
              <tr className="bg-gray-50/40">
                <td className="px-3 py-2 font-mono font-semibold text-gray-800">L2</td>
                <td className="px-3 py-2">Ambient soundscapes / risers</td>
                <td className="px-3 py-2 text-gray-600">Steady, looped (rain, wind, risers)</td>
                <td className="px-3 py-2 text-right font-mono">low (v₂)</td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2 font-mono font-semibold text-gray-800">L3</td>
                <td className="px-3 py-2">Background music bed</td>
                <td className="px-3 py-2 text-gray-600">Looped + sidechaincompress (ducks on speech)</td>
                <td className="px-3 py-2 text-right font-mono">v₃ (ducked)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
          {[
            { label: "L1 speeches", value: speeches.length },
            { label: "L2 ambient", value: ambientTracks.length },
            { label: "L3 music", value: musicTracks.length },
            { label: "v₂ ambient", value: ambientVolume.toFixed(2) },
            { label: "v₃ music", value: musicVolume.toFixed(2) },
            { label: "t_in / t_out", value: `${(introMs / 1000).toFixed(1)}s/${outroSec.toFixed(1)}s` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{m.label}</div>
              <div className="text-xs sm:text-sm font-semibold font-mono text-gray-800 tabular-nums truncate">{m.value}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Upload + libraries */}
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2 border-b pb-2 flex-wrap">
          <h2 className="text-base sm:text-lg font-semibold">① Upload Audio Layers</h2>
          <span className="text-[11px] font-mono text-gray-400">total tracks = {tracks.length}</span>
        </div>

        <form onSubmit={handleUpload} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end rounded-lg border border-dashed bg-gray-50/50 p-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">Track name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Soft rain, Cinematic riser, Lo-fi bed"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">Audio file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">Layer / kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TrackKind)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="music">L3 — Music bed (ducked)</option>
              <option value="ambient">L2 — Ambient/texture (steady)</option>
            </select>
          </div>
          <div className="lg:pb-0.5">
            <button
              type="submit"
              disabled={uploading || !file}
              className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {uploading ? "Saving…" : "＋ Upload"}
            </button>
          </div>
          <div className="text-[11px] text-gray-500 lg:col-span-4">
            {file ? <>Selected: <span className="font-mono">{file.name}</span> ({fmtSize(file.size)}) → <span className="font-mono">{kind === "music" ? "L3 music" : "L2 ambient"}</span></> : "Choose a file and assign it to L2 (ambient/riser, steady) or L3 (music, auto-ducked)."}
          </div>
        </form>

        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">L2 — Ambient / Texture Library</h3>
              <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-mono text-teal-700">n = {ambientTracks.length}</span>
            </div>
            <p className="text-[11px] text-gray-500">Rain, wind, risers — steady low level, no ducking.</p>
            {renderTrackTable(ambientTracks, "L2 · ambient (steady)", "No ambient textures yet. Upload rain/wind/risers as L2.")}
          </div>

          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">L3 — Music Bed Library</h3>
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-mono text-blue-700">n = {musicTracks.length}</span>
            </div>
            <p className="text-[11px] text-gray-500">Looped background music — auto-ducked via sidechaincompress during speech.</p>
            {renderTrackTable(musicTracks, "L3 · music (ducked)", "No music beds yet. Upload background music as L3.")}
          </div>

          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">L1 — Created Voiceovers</h3>
              <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-mono text-purple-700">n = {speeches.length}</span>
            </div>
            <p className="text-[11px] text-gray-500">Cloned speech (EN/SW), foreground at ~ −16 LUFS.</p>
            {speeches.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm text-gray-400">
                ∅ &nbsp; No speeches yet. Generate on Text-to-Speech.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold w-10">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Engine / ID</th>
                      <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">T</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {speeches.map((s, i) => {
                      const id = s.audio_r2_key?.split("/").pop() || String(i);
                      return (
                        <tr key={s.audio_url} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                          <td className="px-3 py-2 font-mono text-gray-400 tabular-nums">{i + 1}</td>
                          <td className="px-3 py-2 max-w-[10rem]">
                            <div className="truncate font-medium text-gray-800">{s.engine_used}</div>
                            <div className="text-[10px] text-gray-400 font-mono">L1 · voice</div>
                            <div className="text-[11px] text-gray-400 font-mono truncate sm:hidden" title={id}>
                              {id.slice(0, 12)}{s.duration_seconds ? ` · ${s.duration_seconds.toFixed(1)}s` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2 hidden sm:table-cell text-[11px] text-gray-500 font-mono tabular-nums">
                            {s.duration_seconds ? `${s.duration_seconds.toFixed(2)}s` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1.5 flex-wrap">
                              <a href={s.audio_url} download={`speech-${id}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">Save</a>
                              <button onClick={() => handleDeleteSpeech(s.audio_url)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Remove</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-gray-400">Auto-synced from Text-to-Speech history.</p>
          </div>
        </div>

        <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      </section>

      {/* Merge Matrix */}
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2">
          <h2 className="text-base sm:text-lg font-semibold">② Mix / Master Matrix</h2>
          <span className="text-[11px] font-mono text-gray-400">L1 required · L2/L3 optional (voice-only mastering supported)</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">L1 — Voiceover (foreground)</div>
            <select
              value={selectedSpeech}
              onChange={(e) => setSelectedSpeech(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            >
              <option value="">∅ Select speech…</option>
              {speeches.map((s) => (
                <option key={s.audio_url} value={s.audio_url}>
                  {s.engine_used} — {s.audio_r2_key?.split("/").pop()?.slice(0, 14)}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-gray-500 font-mono">clear, upfront · target ~ −16 LUFS</div>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">L2 — Ambient / Texture (steady)</div>
            <select
              value={selectedAmbient}
              onChange={(e) => setSelectedAmbient(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
            >
              <option value="">∅ None (optional)</option>
              {ambientTracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div className="text-[11px] text-gray-500 font-mono">rain/wind/risers · no ducking</div>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">L3 — Music Bed (ducked)</div>
            <select
              value={selectedMusic}
              onChange={(e) => setSelectedMusic(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">∅ None (optional)</option>
              {musicTracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div className="text-[11px] text-gray-500 font-mono">looped · sidechaincompress on voice</div>
          </div>
        </div>

        <div className="rounded-lg border bg-gray-50/40 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Expert presets (P)</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                title={`v₂=${p.v2}, v₃=${p.v3}, t_in=${p.tin}ms, t_out=${p.tout}s`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Parameter</th>
                <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                <th className="px-3 py-2 text-left font-semibold min-w-[160px] sm:min-w-[240px]">Control</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-right font-semibold hidden sm:table-cell">Range</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-white">
                <td className="px-3 py-3 font-medium text-gray-800">Ambient volume (L2)</td>
                <td className="px-3 py-3 font-mono text-gray-500">v₂</td>
                <td className="px-3 py-3">
                  <input type="range" min={0} max={1} step={0.01} value={ambientVolume} onChange={(e) => setAmbientVolume(parseFloat(e.target.value))} className="w-full accent-teal-600" />
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-800">{Math.round(ambientVolume * 100)}%</td>
                <td className="px-3 py-3 text-right font-mono text-[11px] text-gray-400 hidden sm:table-cell">[0, 1]</td>
              </tr>
              <tr className="bg-gray-50/40">
                <td className="px-3 py-3 font-medium text-gray-800">Music volume (L3)</td>
                <td className="px-3 py-3 font-mono text-gray-500">v₃</td>
                <td className="px-3 py-3">
                  <input type="range" min={0} max={1} step={0.01} value={musicVolume} onChange={(e) => setMusicVolume(parseFloat(e.target.value))} className="w-full accent-blue-600" />
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-800">{Math.round(musicVolume * 100)}%</td>
                <td className="px-3 py-3 text-right font-mono text-[11px] text-gray-400 hidden sm:table-cell">[0, 1]</td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-3 font-medium text-gray-800">Intro delay</td>
                <td className="px-3 py-3 font-mono text-gray-500">t<sub>in</sub></td>
                <td className="px-3 py-3">
                  <input type="range" min={0} max={10000} step={100} value={introMs} onChange={(e) => setIntroMs(parseInt(e.target.value))} className="w-full accent-purple-600" />
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-800">{introMs} ms</td>
                <td className="px-3 py-3 text-right font-mono text-[11px] text-gray-400 hidden sm:table-cell">[0, 10000]</td>
              </tr>
              <tr className="bg-gray-50/40">
                <td className="px-3 py-3 font-medium text-gray-800">Outro pad</td>
                <td className="px-3 py-3 font-mono text-gray-500">t<sub>out</sub></td>
                <td className="px-3 py-3">
                  <input type="range" min={0} max={10} step={0.5} value={outroSec} onChange={(e) => setOutroSec(parseFloat(e.target.value))} className="w-full accent-purple-600" />
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-800">{outroSec.toFixed(1)} s</td>
                <td className="px-3 py-3 text-right font-mono text-[11px] text-gray-400 hidden sm:table-cell">[0, 10]</td>
              </tr>
            </tbody>
          </table>
        </div>

        {mergeError && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{mergeError}</p>}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <button
            onClick={handleMerge}
            disabled={merging || !ready}
            className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {merging ? "Processing…" : "🔀 Mix / Master & Export"}
          </button>
          <button
            type="button"
            onClick={resetMerge}
            className="rounded-md border border-gray-300 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50"
          >
            Reset
          </button>
          <div className="text-[11px] text-gray-400 font-mono">
            ready = L1:{selectedSpeech ? "1" : "0"} · L2:{selectedAmbient ? "1" : "0"} · L3:{selectedMusic ? "1" : "0"} → {ready ? "true" : "false"} {selectedSpeech && !selectedMusic && !selectedAmbient ? "(master only)" : ""}
          </div>
        </div>

        {mergeResult && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-green-800">✅ 3-layer mix rendered</p>
              {mergeResult.duration_seconds ? (
                <span className="text-xs font-mono text-green-700 bg-green-100 px-2 py-0.5 rounded">
                  T = {mergeResult.duration_seconds.toFixed(2)} s
                </span>
              ) : null}
            </div>
            <audio controls src={mergeResult.audio_url} className="w-full h-10" autoPlay />
            <div className="flex items-center gap-3 flex-wrap">
              <a
                href={mergeResult.audio_url}
                download={`mix-${mergeResult.audio_r2_key?.split("/").pop() || "output.mp3"}`}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
              >
                ⬇ Download MP3
              </a>
              <span className="text-[11px] text-gray-500 font-mono truncate max-w-full">
                {mergeResult.audio_r2_key || "mixed output"}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
