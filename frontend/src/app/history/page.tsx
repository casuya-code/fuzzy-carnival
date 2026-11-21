"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { clearDeliverables, DeliverableItem, loadDeliverables, removeDeliverable } from "@/lib/history";

const KIND_LABEL: Record<DeliverableItem["kind"], string> = {
  trimmed: "Trimmed & Zoomed",
  captioned: "Animated Captions",
  thumbnail: "Thumbnail",
  package: "Published Package",
};

const KIND_ICON: Record<DeliverableItem["kind"], string> = {
  trimmed: "✂️",
  captioned: "💬",
  thumbnail: "🖼️",
  package: "📦",
};

/** Show the metadata we already persist for each deliverable instead of hiding it. */
function MetaDetails({ meta }: { meta?: Record<string, unknown> }) {
  if (!meta) return null;
  const bits: React.ReactNode[] = [];
  if (typeof meta.width === "number" && typeof meta.height === "number") {
    bits.push(<span key="wh">{meta.width}×{meta.height}</span>);
  }
  if (Array.isArray(meta.hook_words)) {
    bits.push(<span key="hook">hook: {(meta.hook_words as string[]).join(" / ")}</span>);
  }
  if (typeof meta.duration_seconds === "number") {
    bits.push(<span key="t">T={meta.duration_seconds.toFixed(1)}s</span>);
  }
  if (typeof meta.aspect_ratio === "string") {
    bits.push(<span key="ar">{meta.aspect_ratio}</span>);
  }
  if (typeof meta.start_sec === "number" && typeof meta.length_sec === "number") {
    bits.push(<span key="range">start {meta.start_sec}s · {meta.length_sec}s</span>);
  }
  if (typeof meta.ass_url === "string" && meta.ass_url) {
    bits.push(
      <a key="ass" href={meta.ass_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
        soft subs (.ass)
      </a>
    );
  }
  if (bits.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-gray-500">
      {bits}
    </div>
  );
}

export default function HistoryPage() {
  const [items, setItems] = useState<DeliverableItem[]>([]);

  useEffect(() => {
    setItems(loadDeliverables());
  }, []);

  const handleRemove = (url: string) => {
    setItems(removeDeliverable(url));
  };

  const handleClear = () => {
    if (!confirm("Clear all history?")) return;
    clearDeliverables();
    setItems([]);
  };

  const grouped = (["trimmed", "captioned", "thumbnail", "package"] as const).map((kind) => ({
    kind,
    list: items.filter((i) => i.kind === kind),
  }));

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🗂️ My Files</h1>
          <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-2xl">
            Your recent videos, thumbnails, and ready-to-post packages appear here.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleClear}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Clear list
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
          <div className="text-base font-medium text-gray-700">No saved videos, thumbnails, or packages yet</div>
          <p className="mt-2 text-sm text-gray-500">
            When you create or export videos, captions, thumbnails, or ready-to-post packages, they will appear here.
            Generated speech files are saved separately for reuse in <span className="font-medium">Text to Speech</span> and <span className="font-medium">Add Music &amp; Sounds</span>.
          </p>
        </div>
      )}

      {grouped.map(({ kind, list }) =>
        list.length === 0 ? null : (
          <section key={kind} className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span>{KIND_ICON[kind]}</span>
              {KIND_LABEL[kind]}
              <span className="text-xs font-normal text-gray-400">({list.length})</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((item) => (
                <div key={item.id} className="rounded-lg border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800">{item.title}</div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(item.url)}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>

                  {item.kind === "thumbnail" ? (
                    <Image
                      src={item.url}
                      alt={item.title}
                      width={320}
                      height={180}
                      unoptimized
                      className="mt-3 h-32 w-full rounded object-cover"
                    />
                  ) : item.kind === "package" && item.meta?.short_urls ? (
                    <div className="mt-3 space-y-1 text-[11px]">
                      <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-blue-600 hover:underline">
                        Master: {item.url.split("/").pop()}
                      </a>
                      {Array.isArray(item.meta.short_urls) &&
                        (item.meta.short_urls as string[]).map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" className="block truncate text-blue-600 hover:underline">
                            Short {i + 1}: {u.split("/").pop()}
                          </a>
                        ))}
                      {typeof item.meta.thumbnail_url === "string" && (
                        <a href={item.meta.thumbnail_url as string} target="_blank" rel="noreferrer" className="block truncate text-blue-600 hover:underline">
                          Thumbnail
                        </a>
                      )}
                    </div>
                  ) : (
                    <video
                      src={item.url}
                      className="mt-3 h-32 w-full rounded bg-black object-contain"
                      controls
                      preload="none"
                      playsInline
                    />
                  )}

                  <MetaDetails meta={item.meta} />

                  <div className="mt-3 flex gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Download
                    </a>
                    {item.r2_key && (
                      <span className="truncate text-[10px] text-gray-400">{item.r2_key}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      )}
    </div>
  );
}
