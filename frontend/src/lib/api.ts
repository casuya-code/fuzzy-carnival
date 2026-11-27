import type { LowerThird, TextStyle } from "@/lib/textStyles";
import { measured, reportMetric } from "@/lib/performance";

/** Single source of truth for the backend origin (used by every client). */
export const API_BASE = (
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const PUBLIC_API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";
const USER_TOKEN_KEY = "yakodonyo_auth_token";

/** Decode a JWT payload (segment 1) without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    // Backend issues two-part tokens (payload.signature); standard JWTs have
    // three parts (header.payload.signature). Accept both shapes.
    const payloadPart = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : null;
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(base64, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function getUserToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(USER_TOKEN_KEY);
    if (!token) return null;
    const claims = decodeJwtPayload(token);
    if (claims) {
      const exp = typeof claims.exp === "number" ? claims.exp : Number(claims.exp);
      if (Number.isFinite(exp) && exp <= Date.now() / 1000) {
        window.localStorage.removeItem(USER_TOKEN_KEY);
        window.localStorage.removeItem("yakodonyo_auth_user");
        return null;
      }
    }
    return token;
  } catch {
    return null;
  }
}

/** Stable account identifier from the JWT, used to scope client-side history. */
export function getUserUid(): string | null {
  const token = getUserToken();
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  const raw = claims?.uid ?? claims?.sub ?? claims?.email;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function setUserToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(USER_TOKEN_KEY, token);
    else window.localStorage.removeItem(USER_TOKEN_KEY);
  } catch {}
}

/**
 * Authorization header for backend calls. `tokenOverride` lets a long-lived
 * operation (e.g. video job polling) pin the token it started with.
 */
export function backendAuthHeaders(tokenOverride?: string | null): Record<string, string> {
  const token = tokenOverride === undefined ? getUserToken() : tokenOverride;
  if (token) return { Authorization: `Bearer ${token}` };
  return PUBLIC_API_KEY ? { Authorization: `Bearer ${PUBLIC_API_KEY}` } : {};
}

export type ApiError = Error & { status?: number };

function apiError(message: string, status?: number): ApiError {
  const error = new Error(message) as ApiError;
  if (typeof status === "number") error.status = status;
  return error;
}

/** Auth failures are the only reason to discard an otherwise valid session. */
export function isAuthError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

export function clearTokenIfAuthError(error: unknown): boolean {
  if (!isAuthError(error)) return false;
  setUserToken(null);
  try { if (typeof window !== "undefined") window.localStorage.removeItem("yakodonyo_auth_user"); } catch {}
  return true;
}

export interface AuthUser {
  id: number;
  email: string;
  role?: string;
  created_at?: number;
  name?: string;
  phone?: string;
  /** Base64 image data URL for the profile picture. */
  avatar?: string;
}

export async function getAccountStats(): Promise<{ total_users: number }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/stats`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Stats unavailable (${res.status})`);
  return res.json();
}

export async function signup(email: string, password: string): Promise<{ access_token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Signup failed (${res.status})`);
  return res.json();
}

export async function login(email: string, password: string): Promise<{ access_token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Login failed (${res.status})`);
  return res.json();
}

export async function me(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
    headers: backendAuthHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw apiError(detail || `Auth check failed (${res.status})`, res.status);
  }
  const data = await res.json();
  return data.user as AuthUser;
}

export async function updateProfile(payload: {
  name?: string | null;
  phone?: string | null;
  avatar?: string | null;
}): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/v1/auth/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Profile update failed (${res.status})`);
  const data = await res.json();
  return data.user as AuthUser;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ access_token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Password change failed (${res.status})`);
  return res.json();
}

export async function logoutAll(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/auth/logout-all`, {
    method: "POST",
    headers: backendAuthHeaders(),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw apiError(detail || `Logout failed (${res.status})`, res.status);
  }
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message?: string; reset_token?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Reset request failed (${res.status})`);
  return res.json();
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) throw new Error(extractDetail(await res.text()) || `Reset failed (${res.status})`);
}

export type Engine = "kyutai" | "afrispeech" | "msingi" | "mms" | "azure" | "elevenlabs" | "cartesia";
export type Language = "en" | "sw";

/** Shared UI labels and engine availability — keep all engine pickers in sync. */
export const ENGINE_LABEL: Record<Engine, string> = {
  kyutai: "English Voice Clone",
  afrispeech: "English (African Accent)",
  msingi: "Swahili Voice Clone",
  mms: "Swahili (Basic Voice)",
  azure: "Swahili Natural Voice",
  elevenlabs: "Expressive Voice (Online)",
  cartesia: "Cartesia Voice (Online)",
};

export const ENGINES_BY_LANGUAGE: Record<Language, Engine[]> = {
  en: ["kyutai", "afrispeech", "elevenlabs", "cartesia"],
  sw: ["azure", "msingi", "mms", "elevenlabs", "cartesia"],
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
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const j = JSON.parse(trimmed);
    if (j && typeof j.detail === "string") return j.detail;
    if (j && typeof j.detail === "number") return String(j.detail);
    if (j && Array.isArray(j.detail)) return j.detail.map(String).join("; ");
    if (j && typeof j.message === "string") return j.message;
    if (j && typeof j.error === "string") return j.error;
  } catch {}
  // Avoid dumping huge HTML error pages into the UI.
  return trimmed.length > 300 ? trimmed.slice(0, 297) + "…" : trimmed;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store", headers: backendAuthHeaders() });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

async function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function synthesize(
  payload: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResponse> {
  const started = performance.now();
  const maxRetries = 3;
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(`${API_BASE}/api/v1/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
        body: JSON.stringify(payload),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        reportSpeechTiming(payload, data, started);
        return data;
      }
      const detail = extractDetail(await res.text());
      const retryAfter = Number(res.headers.get("Retry-After"));
      const busy = /still running|rate limit|too many requests/i.test(detail);
      const retryable = res.status === 429 || (res.status === 503 && (Number.isFinite(retryAfter) && retryAfter > 0 || busy));
      if (retryable && attempt < maxRetries) {
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000;
        await waitForRetry(delayMs, signal);
        continue;
      }
      throw apiError(detail || `Synthesis failed (${res.status})`, res.status);
    }
    throw apiError("Synthesis failed", 500);
  } catch (e) {
    reportMetric("speech.generate", performance.now() - started, {
      engine: (payload as { engine?: string }).engine || "default",
      language: payload.language || "en",
      status: (e as { name?: string })?.name === "AbortError" ? "cancelled" : "error",
    });
    throw e;
  }
}

function reportSpeechTiming(payload: SynthesizeRequest, data: SynthesizeResponse, started: number) {
  reportMetric("speech.generate", performance.now() - started, {
    engine: data.engine_used || (payload as { engine?: string }).engine || "default",
    language: payload.language || "en",
    cache_hit: Boolean((data as { cache_hit?: boolean }).cache_hit),
    status: "ok",
  });
}

export async function normalizePreview(
  text: string,
  language: "en" | "sw"
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/normalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error("Normalize failed");
  const data = await res.json();
  return data.normalized as string;
}

/** Best-effort pre-warm. Reports failure explicitly instead of implying success. */
export async function warmEngine(engine: Engine): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/warm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
      body: JSON.stringify({ engine }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const _mediaUrlCache = new Map<string, { url: string; exp: number }>();
const _mediaUrlInflight = new Map<string, Promise<string | null>>();
const MEDIA_URL_TTL_MS = 5 * 60 * 1000;

export async function refreshMediaUrl(key: string): Promise<string | null> {
  if (!key) return null;
  const now = Date.now();
  const cached = _mediaUrlCache.get(key);
  if (cached && cached.exp > now) return cached.url;
  const inflight = _mediaUrlInflight.get(key);
  if (inflight) return inflight;

  const req = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/media/url?key=${encodeURIComponent(key)}`, {
        headers: { ...backendAuthHeaders() },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const url = typeof data?.url === "string" ? data.url : null;
      if (url) _mediaUrlCache.set(key, { url, exp: Date.now() + MEDIA_URL_TTL_MS });
      return url;
    } catch {
      return null;
    } finally {
      _mediaUrlInflight.delete(key);
    }
  })();
  _mediaUrlInflight.set(key, req);
  return req;
}

export async function requestUploadUrl(
  filename: string,
  contentType: string,
  contentLength: number
): Promise<{ upload_url: string; key: string }> {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify({ filename, contentType, contentLength }),
  });
  if (!res.ok) throw new Error(`Upload URL request failed: ${res.status}`);
  return res.json();
}

export async function uploadToR2(uploadUrl: string, file: Blob, contentType: string) {
  // The signed content type has no codec parameters (e.g. audio/webm, not
  // audio/webm;codecs=opus). Auth belongs only on backend local-upload URLs;
  // sending it to R2 can invalidate the presigned request.
  const signedType = contentType.split(";")[0].trim().toLowerCase();
  const isLocal = uploadUrl.startsWith(`${API_BASE}/api/v1/local-upload/`);
  return measured("upload.blob", { kind: isLocal ? "local" : "r2" }, async () => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": signedType,
        ...(!isLocal ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
        ...(isLocal ? backendAuthHeaders() : {}),
      },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return true;
  });
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
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Mix failed (${res.status})`);
  }
  return res.json();
}

export async function joinAudio(payload: {
  audio_keys: string[];
  gap_ms?: number;
  crossfade_ms?: number;
  output_format?: "mp3" | "wav";
}): Promise<{ audio_r2_key?: string; audio_url: string; duration_seconds?: number; parts?: number }> {
  const res = await fetch(`${API_BASE}/api/v1/audio/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Join failed (${res.status})`);
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
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
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
  style: TextStyle & {
    aspect_ratio?: string;
    play_res: number[];
    font_size: number;
    margin_l: number;
    margin_r: number;
    margin_v: number;
    highlight: string;
    base: string;
    outline_color?: string;
    outline: number;
  };
  lower_third?: LowerThird;
  lower_third_duration_sec?: number;
  intro_delay_sec: number;
  voice_duration: number;
}

export async function previewCaptions(payload: {
  script_text: string;
  voice_duration: number;
  intro_delay_sec: number;
  aspect_ratio: string;
  words_per_chunk: number;
  caption_style?: TextStyle;
  lower_third?: LowerThird;
  lower_third_duration_sec?: number;
}): Promise<CaptionPreview> {
  const res = await fetch(`${API_BASE}/api/v1/captions/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
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
  /** Explicit quick low-resolution preview; final renders stay full quality. */
  preview?: boolean;
  loudnorm?: boolean;
  caption_style?: TextStyle;
  lower_third?: LowerThird;
  lower_third_duration_sec?: number;
  font_path?: string | null;
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
  if (payload.caption_style) fd.append("caption_style", JSON.stringify(payload.caption_style));
  if (payload.lower_third) fd.append("lower_third", JSON.stringify(payload.lower_third));
  if (payload.lower_third_duration_sec != null) fd.append("lower_third_duration_sec", String(payload.lower_third_duration_sec));
  if (payload.font_path) fd.append("font_path", payload.font_path);
  const res = await fetch(`${API_BASE}/api/v1/captions/burn`, { method: "POST", body: fd, headers: backendAuthHeaders() });
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
  transition_sfx?: string;
  transition_sfx_level?: number;
  overlay?: string;
  overlay_image?: boolean;
  overlay_position?: string;
  overlay_size?: number;
  overlay_opacity?: number;
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
  transition?: string;
  transition_duration_sec?: number;
  transitions?: string[];
  overlay?: string;
  preview?: boolean;
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
  if (payload.transition) fd.append("transition", payload.transition);
  if (payload.transition_duration_sec != null) fd.append("transition_duration_sec", String(payload.transition_duration_sec));
  if (payload.transitions) fd.append("transitions", JSON.stringify(payload.transitions));
  if (payload.overlay) fd.append("overlay", payload.overlay);
  if (payload.preview) fd.append("preview", "true");
  return measured("video.render", { kind: "batch" }, async () => {
    const res = await fetch(`${API_BASE}/api/v1/video/process-batch`, {
      method: "POST",
      body: fd,
      headers: backendAuthHeaders(),
    });
    if (!res.ok) {
      const detail = extractDetail(await res.text());
      throw new Error(detail || `Video batch processing failed (${res.status})`);
    }
    return res.json();
  });
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
  /** Explicit quick low-resolution preview; final renders stay full quality. */
  preview?: boolean;
  loudnorm?: boolean;
  transition?: string;
  transition_duration_sec?: number;
  transitions?: string[];
  transition_sfx?: string;
  transition_sfx_level?: number;
  overlay_image?: File | null;
  overlay_position?: string;
  overlay_size?: number;
  overlay_opacity?: number;
  overlay?: string;
  caption_style?: TextStyle;
  lower_third?: LowerThird;
  lower_third_duration_sec?: number;
  font_path?: string | null;
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
  if (payload.transition) fd.append("transition", payload.transition);
  if (payload.transition_duration_sec != null) fd.append("transition_duration_sec", String(payload.transition_duration_sec));
  if (payload.transitions) fd.append("transitions", JSON.stringify(payload.transitions));
  if (payload.transition_sfx) fd.append("transition_sfx", payload.transition_sfx);
  if (payload.transition_sfx_level != null) fd.append("transition_sfx_level", String(payload.transition_sfx_level));
  if (payload.overlay_image) fd.append("overlay_image", payload.overlay_image, payload.overlay_image.name);
  if (payload.overlay_position) fd.append("overlay_position", payload.overlay_position);
  if (payload.overlay_size != null) fd.append("overlay_size", String(payload.overlay_size));
  if (payload.overlay_opacity != null) fd.append("overlay_opacity", String(payload.overlay_opacity));
  if (payload.overlay) fd.append("overlay", payload.overlay);
  if (payload.caption_style) fd.append("caption_style", JSON.stringify(payload.caption_style));
  if (payload.lower_third) fd.append("lower_third", JSON.stringify(payload.lower_third));
  if (payload.lower_third_duration_sec != null) fd.append("lower_third_duration_sec", String(payload.lower_third_duration_sec));
  if (payload.font_path) fd.append("font_path", payload.font_path);
  if (payload.preview) fd.append("preview", "true");
  return measured("video.render", { kind: "finalize" }, async () => {
    const res = await fetch(`${API_BASE}/api/v1/video/finalize`, {
      method: "POST",
      body: fd,
      headers: backendAuthHeaders(),
    });
    if (!res.ok) {
      const detail = extractDetail(await res.text());
      throw new Error(detail || `Video finalize failed (${res.status})`);
    }
    return res.json();
  });
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
  /** Explicit quick low-resolution preview; final renders stay full quality. */
  preview?: boolean;
  loudnorm?: boolean;
  transition?: string;
  transition_duration_sec?: number;
  transitions?: string[];
  transition_sfx?: string;
  transition_sfx_level?: number;
  overlay_image?: File | null;
  overlay_position?: string;
  overlay_size?: number;
  overlay_opacity?: number;
  overlay?: string;
  caption_style?: TextStyle;
  lower_third?: LowerThird;
  lower_third_duration_sec?: number;
  font_path?: string | null;
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
  if (payload.transition) fd.append("transition", payload.transition);
  if (payload.transition_duration_sec != null) fd.append("transition_duration_sec", String(payload.transition_duration_sec));
  if (payload.transitions) fd.append("transitions", JSON.stringify(payload.transitions));
  if (payload.transition_sfx) fd.append("transition_sfx", payload.transition_sfx);
  if (payload.transition_sfx_level != null) fd.append("transition_sfx_level", String(payload.transition_sfx_level));
  if (payload.overlay_image) fd.append("overlay_image", payload.overlay_image, payload.overlay_image.name);
  if (payload.overlay_position) fd.append("overlay_position", payload.overlay_position);
  if (payload.overlay_size != null) fd.append("overlay_size", String(payload.overlay_size));
  if (payload.overlay_opacity != null) fd.append("overlay_opacity", String(payload.overlay_opacity));
  if (payload.overlay) fd.append("overlay", payload.overlay);
  if (payload.caption_style) fd.append("caption_style", JSON.stringify(payload.caption_style));
  if (payload.lower_third) fd.append("lower_third", JSON.stringify(payload.lower_third));
  if (payload.lower_third_duration_sec != null) fd.append("lower_third_duration_sec", String(payload.lower_third_duration_sec));
  if (payload.font_path) fd.append("font_path", payload.font_path);
  if (payload.preview) fd.append("preview", "true");
  return measured("video.render", { kind: "process" }, async () => {
    const res = await fetch(`${API_BASE}/api/v1/video/process`, {
      method: "POST",
      body: fd,
      headers: backendAuthHeaders(),
    });
    if (!res.ok) {
      const detail = extractDetail(await res.text());
      throw new Error(detail || `Video processing failed (${res.status})`);
    }
    return res.json();
  });
}

export interface VideoJobAccepted {
  job_id: string;
  status: string;
  status_url: string;
}

export interface VideoJobStatus {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string;
  result?: VideoProcessResult;
  error?: string;
  error_status?: number;
}

function formDataFrom(payload: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || value === "") continue;
    if (value instanceof File) {
      fd.append(key, value, value.name);
    } else if (Array.isArray(value)) {
      if (key === "clips") value.forEach((f) => fd.append(key, f as File, (f as File).name));
      else fd.append(key, JSON.stringify(value));
    } else if (typeof value === "object") {
      fd.append(key, JSON.stringify(value));
    } else {
      fd.append(key, String(value));
    }
  }
  return fd;
}

/**
 * Auth headers are pinned when a job is submitted so a token change during a
 * long render cannot make its later status/cancel calls look like a stranger.
 */
const jobHeaders = new Map<string, Record<string, string>>();

function pinnedJobHeaders(jobId: string): Record<string, string> {
  let headers = jobHeaders.get(jobId);
  if (!headers) {
    headers = backendAuthHeaders();
    jobHeaders.set(jobId, headers);
  }
  return headers;
}

type JobRequestOptions = { signal?: AbortSignal };

/** Submit a render as a background job. Payload matches the sync API payloads. */
export function submitVideoJob(
  kind: "process" | "batch" | "finalize",
  payload: Record<string, unknown>,
): Promise<VideoJobAccepted> {
  return measured("video.job.submit", { kind }, async () => {
    const headers = backendAuthHeaders();
    const res = await fetch(`${API_BASE}/api/v1/video/jobs/${kind}`, {
      method: "POST",
      body: formDataFrom(payload),
      headers,
    });
    if (!res.ok) {
      const detail = extractDetail(await res.text());
      throw new Error(detail || `Video job submission failed (${res.status})`);
    }
    const accepted = (await res.json()) as VideoJobAccepted;
    if (accepted?.job_id) jobHeaders.set(accepted.job_id, headers);
    return accepted;
  });
}

export async function getVideoJob(
  jobId: string,
  options: JobRequestOptions = {},
): Promise<VideoJobStatus> {
  const res = await fetch(`${API_BASE}/api/v1/video/jobs/${encodeURIComponent(jobId)}`, {
    headers: pinnedJobHeaders(jobId),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Job status failed (${res.status})`);
  return res.json();
}

export async function cancelVideoJob(
  jobId: string,
  options: JobRequestOptions = {},
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/video/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: pinnedJobHeaders(jobId),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Job cancel failed (${res.status})`);
}

function abortableSleep(
  ms: number,
  signal: AbortSignal,
  abortError: () => Error,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let onAbort: () => void;
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Poll a background render until it reaches a terminal state. */
export async function waitForVideoJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (status: VideoJobStatus) => void;
  } = {},
): Promise<VideoJobStatus> {
  const started = performance.now();
  const interval = options.intervalMs ?? 1000;
  const timeout = options.timeoutMs ?? 900_000;
  const controller = new AbortController();
  let externallyAborted = false;
  let timedOut = false;

  const onExternalAbort = () => {
    externallyAborted = true;
    controller.abort();
  };
  if (options.signal?.aborted) onExternalAbort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const failure = () => {
    const error = new Error(timedOut ? "Video job timed out" : "Video job cancelled");
    error.name = timedOut ? "TimeoutError" : "AbortError";
    return error;
  };
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    while (true) {
      if (controller.signal.aborted) throw failure();
      let status: VideoJobStatus;
      try {
        status = await getVideoJob(jobId, { signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) throw failure();
        throw e;
      }
      if (controller.signal.aborted) throw failure();
      options.onProgress?.(status);
      if (["succeeded", "failed", "cancelled"].includes(status.status)) {
        reportMetric("video.job.total", performance.now() - started, {
          kind: status.kind,
          status: status.status,
        });
        jobHeaders.delete(jobId);
        if (status.status === "failed") throw new Error(status.error || "Video job failed");
        if (status.status === "cancelled") throw new Error("Video job cancelled");
        return status;
      }
      await abortableSleep(interval, controller.signal, failure);
    }
  } catch (e) {
    if (externallyAborted) {
      // Best effort: release the backend slot even though polling has stopped.
      try {
        await cancelVideoJob(jobId);
      } catch {}
      jobHeaders.delete(jobId);
    }
    throw e;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
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
  frame?: string;
  shape?: string;
  topic?: string;
  language?: string;
  text_style?: TextStyle;
  font_path?: string | null;
}): Promise<{ thumbnail_url: string; thumbnail_r2_key: string; width: number; height: number; hook_words: string[] }> {
  const fd = new FormData();
  if (payload.master_video) fd.append("master_video", payload.master_video, payload.master_video.name);
  if (payload.master_r2_key) fd.append("master_r2_key", payload.master_r2_key);
  fd.append("hook_words", payload.hook_words);
  fd.append("accent", payload.accent);
  fd.append("gradient", payload.gradient);
  fd.append("border", String(payload.border));
  if (payload.frame) fd.append("frame", payload.frame);
  if (payload.shape) fd.append("shape", payload.shape);
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.text_style) fd.append("text_style", JSON.stringify(payload.text_style));
  if (payload.font_path) fd.append("font_path", payload.font_path);
  const res = await fetch(`${API_BASE}/api/v1/packaging/thumbnail`, { method: "POST", body: fd, headers: backendAuthHeaders() });
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
  frame?: string;
  shape?: string;
  shorts_title: string;
  clip_length_sec: number;
  start_times: number[];
  phases: string[];
  topic?: string;
  language?: string;
  upscale_2k?: boolean;
  /** Explicit quick low-resolution preview; final renders stay full quality. */
  preview?: boolean;
  loudnorm?: boolean;
  text_style?: TextStyle;
  lower_third?: LowerThird;
  font_path?: string | null;
}): Promise<PackageResult> {
  const fd = new FormData();
  if (payload.master_video) fd.append("master_video", payload.master_video, payload.master_video.name);
  if (payload.master_r2_key) fd.append("master_r2_key", payload.master_r2_key);
  fd.append("hook_words", payload.hook_words);
  fd.append("accent", payload.accent);
  fd.append("gradient", payload.gradient);
  fd.append("border", String(payload.border));
  if (payload.frame) fd.append("frame", payload.frame);
  if (payload.shape) fd.append("shape", payload.shape);
  fd.append("shorts_title", payload.shorts_title);
  fd.append("clip_length_sec", String(payload.clip_length_sec));
  fd.append("start_times", payload.start_times.join(","));
  fd.append("phases", payload.phases.join(","));
  if (payload.topic) fd.append("topic", payload.topic);
  if (payload.language) fd.append("language", payload.language);
  if (payload.upscale_2k != null) fd.append("upscale_2k", String(payload.upscale_2k));
  if (payload.loudnorm != null) fd.append("loudnorm", String(payload.loudnorm));
  if (payload.text_style) fd.append("text_style", JSON.stringify(payload.text_style));
  if (payload.lower_third) fd.append("lower_third", JSON.stringify(payload.lower_third));
  if (payload.font_path) fd.append("font_path", payload.font_path);
  const res = await fetch(`${API_BASE}/api/v1/packaging/publish`, { method: "POST", body: fd, headers: backendAuthHeaders() });
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
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
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
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Analyze failed (${res.status})`);
  }
  return res.json();
}

export interface SfxResult {
  kind: string;
  audio_r2_key: string;
  audio_url: string;
  duration_seconds?: number;
}

export async function generateSfx(payload: {
  kind: string;
  duration_sec?: number;
  output_format?: "mp3" | "wav";
}): Promise<SfxResult> {
  const res = await fetch(`${API_BASE}/api/v1/audio/sfx`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `SFX generation failed (${res.status})`);
  }
  return res.json();
}

export interface BrandFontResult {
  font_path: string;
  font_name: string;
  font_style: string;
}

export async function uploadBrandFont(file: File): Promise<BrandFontResult> {
  const fd = new FormData();
  fd.append("font", file, file.name);
  const res = await fetch(`${API_BASE}/api/v1/fonts/upload`, { method: "POST", body: fd, headers: backendAuthHeaders() });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Font upload failed (${res.status})`);
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
    headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = extractDetail(await res.text());
    throw new Error(detail || `Timeline generation failed (${res.status})`);
  }
  return res.json();
}