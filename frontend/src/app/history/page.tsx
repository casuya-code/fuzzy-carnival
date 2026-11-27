"use client";

import RequireAuth from "@/components/RequireAuth";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearDeliverables, DeliverableItem, loadDeliverables, removeDeliverable } from "@/lib/history";
import { refreshMediaUrl } from "@/lib/api";
import InfoTip from "@/components/InfoTip";

const KIND_LABEL: Record<DeliverableItem["kind"], string> = {
  trimmed: "Trimmed & Zoomed",
  captioned: "Animated Captions",
  thumbnail: "Thumbnail",
  package: "Published Package",
  preset: "Saved Presets",
};

const KIND_ICON: Record<DeliverableItem["kind"], string> = {
  trimmed: "✂️",
  captioned: "💬",
  thumbnail: "🖼️",
  package: "📦",
  preset: "⚙️",
};

/** Show the metadata we already persist for each deliverable instead of hiding it. */
function MetaDetails({ meta }: { meta?: Record<string, unknown> }) {
  if (!meta) return null;
  const bits: React.ReactNode[] = [];
  if (typeof meta.width === "number" && typeof meta.height === "number") {
    bits.push(<span key="wh">{meta.width}×{meta.height}</span>);
  }
  if (Array.isArray(meta.hook_words)) {
    bits.push(<span key="hook">Hook {(meta.hook_words as string[]).join(" / ")}</span>);
  }
  if (typeof meta.duration_seconds === "number") {
    bits.push(<span key="t">Length {meta.duration_seconds.toFixed(1)}s</span>);
  }
  if (typeof meta.aspect_ratio === "string") {
    bits.push(<span key="ar">{meta.aspect_ratio}</span>);
  }
  if (typeof meta.start_sec === "number" && typeof meta.length_sec === "number") {
    bits.push(<span key="range">Range {meta.start_sec}s · {meta.length_sec}s</span>);
  }
  if (typeof meta.ass_url === "string" && meta.ass_url) {
    bits.push(
      <a key="ass" href={meta.ass_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
        soft subs (.ass)
      </a>
    );
  }
  if (typeof meta.route === "string" && meta.route) {
    bits.push(<span key="route">Route {meta.route}</span>);
  }
  if (meta.settings && typeof meta.settings === "object") {
    const s = meta.settings as Record<string, unknown>;
    if (typeof s.aspect_ratio === "string") bits.push(<span key="psar">{s.aspect_ratio}</span>);
    if (typeof s.transition === "string") bits.push(<span key="pstr">{s.transition}</span>);
    if (typeof s.overlay === "string" && s.overlay !== "none") bits.push(<span key="psov">{s.overlay}</span>);
  }
  if (bits.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-gray-500">
      {bits}
    </div>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<DeliverableItem[]>([]);

  useEffect(() => {
    const loaded = loadDeliverables();
    setItems(loaded);
    // Refresh any expired presigned URLs so saved files stay playable.
    (async () => {
      const refreshed = await Promise.all(
        loaded.map(async (it) => {
          if (!it.r2_key) return it;
          const url = await refreshMediaUrl(it.r2_key);
          return url ? { ...it, url } : it;
        })
      );
      setItems(refreshed);
    })();
  }, []);

  const handleRemove = (url: string) => {
    setItems(removeDeliverable(url));
  };

  const handleClear = () => {
    if (!confirm("Clear all history?")) return;
    clearDeliverables();
    setItems([]);
  };

  const grouped = (["preset", "trimmed", "captioned", "thumbnail", "package"] as const).map((kind) => ({
    kind,
    list: items.filter((i) => i.kind === kind),
  }));

  return (
    <RequireAuth>
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🗂️ My Files</h1>
          <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-2xl">
            Recent saved files. <InfoTip text="Videos, thumbnails and packages you created appear here." label="My Files details" />
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
          <div className="text-base font-medium text-gray-700">Nothing saved yet</div>
          <p className="mt-2 text-sm text-gray-500">
            Exports appear here.{" "}
            <InfoTip text="Speech files are kept in the audio tools instead." label="Where speech files go" />
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
                  ) : item.kind === "preset" ? (
                    <div className="mt-3 rounded border bg-gray-50 p-3 text-xs text-gray-600">
                      <div className="font-medium text-gray-700">Preset settings</div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {typeof item.meta?.route === "string" ? `Opens ${item.meta.route}` : "Saved settings"}
                      </div>
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
                    {item.kind === "preset" ? (
                      <button
                        onClick={() => {
                          const route = typeof item.meta?.route === "string" ? item.meta.route : "/publish-package";
                          router.push(`${route}?preset=${encodeURIComponent(item.id)}`);
                        }}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Load
                      </button>
                    ) : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Download
                      </a>
                    )}
                    {item.kind !== "preset" && item.r2_key && (
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
    </RequireAuth>
  );
}
