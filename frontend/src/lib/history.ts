/** Canonical client-side history for generated audio and video. */

import {
  type Language,
  type SynthesizeRequest,
  type TimelineSegment,
  HISTORY_LIMIT,
} from "@/lib/api";

export type { TimelineSegment } from "@/lib/api";

export interface SpeechHistoryItem {
  audio_r2_key: string;
  audio_url: string;
  engine_used?: string;
  duration_seconds?: number;
  source_text?: string;
  timeline?: TimelineSegment[];
  timeline_source?: string;
  warning?: string;
  language?: Language;
  topic?: string;
  /** Exact generation settings, restored when this version is selected. */
  request?: SynthesizeRequest;
}

export interface VideoHistoryItem {
  video_r2_key?: string;
  video_url: string;
  duration_seconds?: number;
  aspect_ratio?: string;
  engine_used?: string;
  clips_processed?: number;
  language?: Language;
  topic?: string;
}

const SPEECH_KEY = "speechHistory";
const VIDEO_KEY = "videoHistory";
const LIMIT = HISTORY_LIMIT;

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // storage may be full or unavailable; history is best-effort
  }
}

export function loadSpeechHistory(): SpeechHistoryItem[] {
  return readList<SpeechHistoryItem>(SPEECH_KEY);
}

export function addSpeechHistory(item: SpeechHistoryItem): SpeechHistoryItem[] {
  const next = [
    item,
    ...loadSpeechHistory().filter((s) => s.audio_url !== item.audio_url),
  ];
  writeList(SPEECH_KEY, next);
  return next.slice(0, LIMIT);
}

/** Persist edits (timeline merge/split, warning, restored request) for one saved take. */
export function updateSpeechHistory(
  url: string,
  patch: Partial<SpeechHistoryItem>
): SpeechHistoryItem[] {
  const next = loadSpeechHistory().map((item) =>
    item.audio_url === url ? { ...item, ...patch } : item
  );
  writeList(SPEECH_KEY, next);
  return next;
}

export function removeSpeechHistory(url: string): SpeechHistoryItem[] {
  const next = loadSpeechHistory().filter((s) => s.audio_url !== url);
  writeList(SPEECH_KEY, next);
  return next;
}

export function loadVideoHistory(): VideoHistoryItem[] {
  return readList<VideoHistoryItem>(VIDEO_KEY);
}

export function addVideoHistory(item: VideoHistoryItem): VideoHistoryItem[] {
  const next = [
    item,
    ...loadVideoHistory().filter((v) => v.video_url !== item.video_url),
  ];
  writeList(VIDEO_KEY, next);
  return next.slice(0, LIMIT);
}

// ---------- Unified deliverable history (videos, captions, thumbnails, packages) ----------

export type DeliverableKind = "trimmed" | "captioned" | "thumbnail" | "package" | "preset";

export interface DeliverableItem {
  id: string;
  kind: DeliverableKind;
  title: string;
  url: string;
  r2_key?: string;
  created_at: number;
  meta?: Record<string, unknown>;
}

const DELIVERABLE_KEY = "deliverableHistory";

export function loadDeliverables(): DeliverableItem[] {
  return readList<DeliverableItem>(DELIVERABLE_KEY);
}

export function addDeliverable(item: Omit<DeliverableItem, "id" | "created_at">): DeliverableItem[] {
  const entry: DeliverableItem = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: Date.now(),
  };
  const next = [entry, ...loadDeliverables().filter((d) => d.url !== item.url)];
  writeList(DELIVERABLE_KEY, next);
  return next.slice(0, LIMIT * 2);
}

export function removeDeliverable(url: string): DeliverableItem[] {
  const next = loadDeliverables().filter((d) => d.url !== url);
  writeList(DELIVERABLE_KEY, next);
  return next;
}

export function clearDeliverables(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(DELIVERABLE_KEY); } catch {}
}

export function getDeliverableById(id: string): DeliverableItem | null {
  return loadDeliverables().find((d) => d.id === id) || null;
}
