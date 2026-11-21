/** Single source of truth for the backend origin (used by every client). */
export const API_BASE = (
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export type Engine = "kyutai" | "afrispeech" | "msingi" | "mms" | "azure" | "elevenlabs";
export type Language = "en" | "sw";

/** Shared UI labels and engine availability — keep all engine pickers in sync. */
export const ENGINE_LABEL: Record<Engine, string> = {
  kyutai: "English Voice Clone",
  afrispeech: "English (African Accent)",
  msingi: "Swahili Voice Clone",
  mms: "Swahili (Basic Voice)",
  azure: "Swahili Natural Voice",
  elevenlabs: "Expressive Voice (Online)",
};

export const ENGINES_BY_LANGUAGE: Record<Language, Engine[]> = {
  en: ["kyutai", "afrispeech", "elevenlabs"],
  sw: ["azure", "msingi", "mms", "elevenlabs"],
};

export const DEFAULT_ENGINE: Record<Language, Engine> = {
  en: "kyutai",
  sw: "azure",
};

/** One shared cap so every history surface shows the same version count. */
export const HISTORY_LIMIT = 20;

export interface SynthesizeRequest {
  text: string;
  language: Language;
  engine: Engine;
  voice_r2_key?: string | null;
  topic?: string;
  skip_cache?: boolean;
  denoise_ref?: boolean;
  /** Delivery pace: <1 slower, >1 faster. Only VITS-based engines (e.g. MMS) apply it. */
  speaking_rate?: number;
}

export interface TimelineSegment {
  id: number;
  start: number;
  end: number;
  duration: number;
  text: string;
}

export interface SynthesizeResponse {
  audio_r2_key: string;
  audio_url: string;
  engine_used: string;
  duration_seconds?: number;
  warning?: string;
  timeline?: TimelineSegment[] | null;
  timeline_source?: "provider" | "alignment" | "estimated" | "unavailable" | string | null;
  source_text?: string | null;
  /** Client-only: the exact request that produced this take, restored when selected. */
  request?: SynthesizeRequest;
}

export interface HealthResponse {
  status: string;
  awake: boolean;
  ready?: boolean;
  loaded_models?: string[];
  /** Non-secret engine/capability flags from the backend, used only for status details. */
  engines?: string[];
  capabilities?: Record<string, boolean>;
  issues?: string[];
}

function extractDetail(text: string): string {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.detail === "string") return j.detail;
  } catch {}
  return text;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function synthesize(
  payload: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResponse> {
  const res = await fetch(`${API_BASE}/api/v1/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Synthesis failed (${res.status})`);
  }
  return res.json();
}

export async function normalizePreview(
  text: string,
  language: "en" | "sw"
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/normalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error("Normalize failed");
  const data = await res.json();
  return data.normalized as string;
}

export async function warmEngine(engine: Engine): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/v1/warm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine }),
    });
  } catch {
    // best-effort pre-warm
  }
}

export async function requestUploadUrl(
  filename: string,
  contentType: string
): Promise<{ upload_url: string; key: string }> {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  });
  if (!res.ok) throw new Error(`Upload URL request failed: ${res.status}`);
  return res.json();
}

export async function uploadToR2(uploadUrl: string, file: Blob, contentType: string) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return true;
}

/** Upload to the backend's local-upload endpoint (dev fallback when R2 is unset). */
export async function uploadLocalBlob(
  key: string,
  file: Blob,
  contentType: string
): Promise<string> {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `${API_BASE}/api/v1/local-upload/${encodedKey}`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    }
  );
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return key;
}

export async function mixAudio(payload: {
  voice_r2_key: string;
  music_r2_key?: string | null;
  music_volume?: number;
  ambient_r2_key?: string | null;
  ambient_volume?: number;
  intro_ms?: number;
  outro_sec?: number;
}): Promise<{ audio_r2_key?: string; audio_url: string; duration_seconds?: number }> {
  const res = await fetch(`${API_BASE}/api/v1/mix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Mix failed (${res.status})`);
  }
  return res.json();
}

export async function transformAudio(payload: {
  audio_r2_key: string;
  speed?: number;
  volume?: number;
  output_format?: "mp3" | "wav";
}): Promise<{ audio_r2_key?: string; audio_url: string; duration_seconds?: number }> {
  const res = await fetch(`${API_BASE}/api/v1/audio/transform`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Transform failed (${res.status})`);
  }
  return res.json();
}

export interface CaptionPreview {
  word_count: number;
  chunk_count: number;
  word_timings: { word: string; start: number; end: number; duration: number; weight: number }[];
  sample_lines: string[];
  style: {
    aspect_ratio: string;
    play_res: number[];
    font_size: number;
    margin_l: number;
    margin_r: number;
    margin_v: number;
    highlight: string;
    base: string;
    outline: number;
  };
  intro_delay_sec: number;
  voice_duration: number;
}

export async function previewCaptions(payload: {
  script_text: string;
  voice_duration: number;
  intro_delay_sec: number;
  aspect_ratio: string;
  words_per_chunk: number;
}): Promise<CaptionPreview> {
  const res = await fetch(`${API_BASE}/api/v1/captions/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Caption preview failed (${res.status})`);
  }
  return res.json();
}

export async function burnCaptions(payload: {
  video?: File | null;
  video_r2_key?: string | null;
  script_text: string;
  intro_delay_sec: number;
  voice_duration?: number | null;
  outro_sec?: number;
  aspect_ratio: string;
  words_per_chunk: number;
  topic?: string;
  language?: string;
  upscale_2k?: boolean;
  loudnorm?: boolean;
}): Promise<{
  video_r2_key?: string;
  video_url: string;
  duration_seconds?: number;
  ass_r2_key?: string;
  ass_url?: string;
  warning?: string;
  word_count?: number;
  chunk_count?: number;
  voice_duration_seconds?: number;
  intro_delay_sec?: number;
}> {
  const fd = new FormData();
  if (payload.video) fd.append("video", payload.video, payload.video.name);
  if (payload.video_r2_key) fd.append("video_r2_key", payload.video_r2_key);
  fd.append("script_text", payload.script_text);
  fd.append("intro_delay_sec", String(payload.intro_delay_sec));
  if (payload.voice_duration != null) fd.append("voice_duration", String(payload.voice_duration));
  fd.append("outro_sec", String(payload.outro_sec ?? 2.5));
  fd.append("aspect_ratio", payload.aspect_ratio);
  fd.append("words_per_chunk", String(payload.words_per_chunk));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.upscale_2k != null) fd.append("upscale_2k", String(payload.upscale_2k));
  if (payload.loudnorm != null) fd.append("loudnorm", String(payload.loudnorm));
  const res = await fetch(`${API_BASE}/api/v1/captions/burn`, { method: "POST", body: fd });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Caption burn failed (${res.status})`);
  }
  return res.json();
}

export interface VideoProcessResult {
  video_r2_key?: string;
  video_url: string;
  duration_seconds?: number;
  clips_processed?: number;
  word_count?: number;
  chunk_count?: number;
}

export interface VideoBatchResult {
  video_r2_key: string;
  video_url: string;
  duration_seconds?: number;
  clips_processed?: number;
  intermediate?: boolean;
  bpm?: number;
  zoom_synced?: boolean;
}

export async function processVideoBatch(payload: {
  clips: File[];
  aspect_ratio: string;
  trim_end_sec: number;
  topic?: string;
  language?: string;
  /** Forward the selected audio so batch jobs use the same beat-synced zoom as /process. */
  audio?: File | null;
  audio_r2_key?: string | null;
  bpm?: number | null;
}): Promise<VideoBatchResult> {
  const fd = new FormData();
  payload.clips.forEach((c) => fd.append("clips", c, c.name));
  fd.append("aspect_ratio", payload.aspect_ratio);
  fd.append("trim_end_sec", String(payload.trim_end_sec));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.audio) fd.append("audio", payload.audio, payload.audio.name);
  if (payload.audio_r2_key) fd.append("audio_r2_key", payload.audio_r2_key);
  if (payload.bpm != null) fd.append("bpm", String(payload.bpm));
  const res = await fetch(`${API_BASE}/api/v1/video/process-batch`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Video batch processing failed (${res.status})`);
  }
  return res.json();
}

export async function finalizeVideo(payload: {
  video_r2_keys: string[];
  audio?: File | null;
  audio_r2_key?: string | null;
  aspect_ratio: string;
  topic?: string;
  language?: string;
  script_text?: string;
  intro_delay_sec?: number;
  outro_sec?: number;
  words_per_chunk?: number;
  upscale_2k?: boolean;
  loudnorm?: boolean;
}): Promise<VideoProcessResult> {
  const fd = new FormData();
  fd.append("video_r2_keys", JSON.stringify(payload.video_r2_keys));
  if (payload.audio) fd.append("audio", payload.audio, payload.audio.name);
  if (payload.audio_r2_key) fd.append("audio_r2_key", payload.audio_r2_key);
  fd.append("aspect_ratio", payload.aspect_ratio);
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.script_text) {
    fd.append("script_text", payload.script_text);
    if (payload.intro_delay_sec != null) fd.append("intro_delay_sec", String(payload.intro_delay_sec));
    if (payload.outro_sec != null) fd.append("outro_sec", String(payload.outro_sec));
    if (payload.words_per_chunk != null) fd.append("words_per_chunk", String(payload.words_per_chunk));
  }
  if (payload.upscale_2k != null) fd.append("upscale_2k", String(payload.upscale_2k));
  if (payload.loudnorm != null) fd.append("loudnorm", String(payload.loudnorm));
  const res = await fetch(`${API_BASE}/api/v1/video/finalize`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Video finalize failed (${res.status})`);
  }
  return res.json();
}

export async function processVideo(payload: {
  clips: File[];
  audio?: File | null;
  audio_r2_key?: string | null;
  aspect_ratio: string;
  trim_end_sec: number;
  topic?: string;
  language?: string;
  script_text?: string;
  intro_delay_sec?: number;
  outro_sec?: number;
  words_per_chunk?: number;
  upscale_2k?: boolean;
  loudnorm?: boolean;
}): Promise<VideoProcessResult> {
  const fd = new FormData();
  payload.clips.forEach((c) => fd.append("clips", c, c.name));
  if (payload.audio) fd.append("audio", payload.audio, payload.audio.name);
  if (payload.audio_r2_key) fd.append("audio_r2_key", payload.audio_r2_key);
  fd.append("aspect_ratio", payload.aspect_ratio);
  fd.append("trim_end_sec", String(payload.trim_end_sec));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.script_text) {
    fd.append("script_text", payload.script_text);
    if (payload.intro_delay_sec != null) {
      fd.append("intro_delay_sec", String(payload.intro_delay_sec));
    }
    if (payload.outro_sec != null) {
      fd.append("outro_sec", String(payload.outro_sec));
    }
    if (payload.words_per_chunk != null) {
      fd.append("words_per_chunk", String(payload.words_per_chunk));
    }
  }
  if (payload.upscale_2k != null) fd.append("upscale_2k", String(payload.upscale_2k));
  if (payload.loudnorm != null) fd.append("loudnorm", String(payload.loudnorm));
  const res = await fetch(`${API_BASE}/api/v1/video/process`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Video processing failed (${res.status})`);
  }
  return res.json();
}

export interface PackageResult {
  package_id: string;
  master: { r2_key: string; url: string; width?: number | null; height?: number | null };
  thumbnail: { r2_key: string; url: string; width: number; height: number; hook_words: string[] };
  shorts: {
    part: number;
    r2_key: string;
    url: string;
    start_sec: number;
    length_sec: number;
    aspect_ratio: string;
  }[];
  master_url: string;
  thumbnail_url: string;
  short_urls: string[];
  duration_seconds?: number;
}

export async function previewThumbnail(payload: {
  master_video?: File | null;
  master_r2_key?: string | null;
  hook_words: string;
  accent: string;
  gradient: string;
  border: boolean;
  topic?: string;
  language?: string;
}): Promise<{ thumbnail_url: string; thumbnail_r2_key: string; width: number; height: number; hook_words: string[] }> {
  const fd = new FormData();
  if (payload.master_video) fd.append("master_video", payload.master_video, payload.master_video.name);
  if (payload.master_r2_key) fd.append("master_r2_key", payload.master_r2_key);
  fd.append("hook_words", payload.hook_words);
  fd.append("accent", payload.accent);
  fd.append("gradient", payload.gradient);
  fd.append("border", String(payload.border));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  const res = await fetch(`${API_BASE}/api/v1/packaging/thumbnail`, { method: "POST", body: fd });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Thumbnail preview failed (${res.status})`);
  }
  return res.json();
}

export async function publishPackage(payload: {
  master_video?: File | null;
  master_r2_key?: string | null;
  hook_words: string;
  accent: string;
  gradient: string;
  border: boolean;
  shorts_title: string;
  clip_length_sec: number;
  start_times: number[];
  phases: string[];
  topic?: string;
  language?: string;
  upscale_2k?: boolean;
  loudnorm?: boolean;
}): Promise<PackageResult> {
  const fd = new FormData();
  if (payload.master_video) fd.append("master_video", payload.master_video, payload.master_video.name);
  if (payload.master_r2_key) fd.append("master_r2_key", payload.master_r2_key);
  fd.append("hook_words", payload.hook_words);
  fd.append("accent", payload.accent);
  fd.append("gradient", payload.gradient);
  fd.append("border", String(payload.border));
  fd.append("shorts_title", payload.shorts_title);
  fd.append("clip_length_sec", String(payload.clip_length_sec));
  fd.append("start_times", payload.start_times.join(","));
  fd.append("phases", payload.phases.join(","));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.upscale_2k != null) fd.append("upscale_2k", String(payload.upscale_2k));
  if (payload.loudnorm != null) fd.append("loudnorm", String(payload.loudnorm));
  const res = await fetch(`${API_BASE}/api/v1/packaging/publish`, { method: "POST", body: fd });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Publish failed (${res.status})`);
  }
  return res.json();
}

export interface ReferenceAnalysis {
  duration: number;
  rms: number;
  peak: number;
  crest_db: number;
  snr_db: number | null;
  clipping: boolean;
  quality_score: number;
  hints: string[];
  sample_rate: number;
}

export async function detectBpm(key: string): Promise<{ bpm: number; cycle_sec: number }> {
  const res = await fetch(`${API_BASE}/api/v1/audio/bpm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `BPM detection failed (${res.status})`);
  }
  return res.json();
}

export async function analyzeAudio(key: string): Promise<ReferenceAnalysis> {
  const res = await fetch(`${API_BASE}/api/v1/audio/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Analyze failed (${res.status})`);
  }
  return res.json();
}

export async function buildSpeechTimeline(payload: {
  audio_r2_key: string;
  text: string;
  prefer_alignment?: boolean;
}): Promise<{
  timeline: TimelineSegment[];
  timeline_source: "alignment" | "estimated" | "unavailable" | string;
  duration_seconds?: number;
  warning?: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/timeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Timeline generation failed (${res.status})`);
  }
  return res.json();
}