/** Canonical client-side history for generated audio and video. */

import {
  type Language,
  type SynthesizeRequest,
  type TimelineSegment,
  HISTORY_LIMIT,
  getUserUid,
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
const SCOPE_PREFIX = "yakodonyo:history:";

/** History is per account; unauthenticated sessions keep the legacy keys. */
function scopedKey(base: string): string {
  const uid = getUserUid();
  return uid ? `${SCOPE_PREFIX}${encodeURIComponent(uid)}:${base}` : base;
}

/** Move pre-scoping history into the current account exactly once. */
function migrateLegacy(scoped: string, base: string): void {
  if (scoped === base) return;
  try {
    const legacy = window.localStorage.getItem(base);
    if (legacy === null) return;
    if (window.localStorage.getItem(scoped) === null) {
      window.localStorage.setItem(scoped, legacy);
    }
    window.localStorage.removeItem(base);
  } catch {
    // history is best-effort
  }
}

function readList<T>(base: string, isValid: (item: unknown) => item is T): T[] {
  if (typeof window === "undefined") return [];
  const key = scopedKey(base);
  migrateLegacy(key, base);
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function writeList<T>(base: string, list: T[]): void {
  if (typeof window === "undefined") return;
  const key = scopedKey(base);
  try {
    window.localStorage.setItem(key, JSON.stringify(list.slice(0, LIMIT)));
    if (key !== base) window.localStorage.removeItem(base);
  } catch {
    // storage may be full or unavailable; history is best-effort
  }
}

const isSpeechItem = (item: unknown): item is SpeechHistoryItem =>
  Boolean(item) &&
  typeof item === "object" &&
  typeof (item as SpeechHistoryItem).audio_url === "string";

const isVideoItem = (item: unknown): item is VideoHistoryItem =>
  Boolean(item) &&
  typeof item === "object" &&
  typeof (item as VideoHistoryItem).video_url === "string";

export function loadSpeechHistory(): SpeechHistoryItem[] {
  return readList(SPEECH_KEY, isSpeechItem);
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
  return readList(VIDEO_KEY, isVideoItem);
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

const isDeliverableItem = (item: unknown): item is DeliverableItem =>
  Boolean(item) &&
  typeof item === "object" &&
  typeof (item as DeliverableItem).id === "string" &&
  typeof (item as DeliverableItem).url === "string" &&
  typeof (item as DeliverableItem).created_at === "number";

export function loadDeliverables(): DeliverableItem[] {
  return readList(DELIVERABLE_KEY, isDeliverableItem);
}

export function addDeliverable(item: Omit<DeliverableItem, "id" | "created_at">): DeliverableItem[] {
  const entry: DeliverableItem = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: Date.now(),
  };
  const next = [entry, ...loadDeliverables().filter((d) => d.url !== item.url)];
  writeList(DELIVERABLE_KEY, next);
  return next.slice(0, LIMIT);
}

export function removeDeliverable(url: string): DeliverableItem[] {
  const next = loadDeliverables().filter((d) => d.url !== url);
  writeList(DELIVERABLE_KEY, next);
  return next;
}

export function clearDeliverables(): void {
  if (typeof window === "undefined") return;
  const key = scopedKey(DELIVERABLE_KEY);
  try {
    window.localStorage.removeItem(key);
    if (key !== DELIVERABLE_KEY) window.localStorage.removeItem(DELIVERABLE_KEY);
  } catch {}
}

export function getDeliverableById(id: string): DeliverableItem | null {
  return loadDeliverables().find((d) => d.id === id) || null;
}
