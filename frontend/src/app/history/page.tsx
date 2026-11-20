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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">History</h1>
          <p className="mt-1 text-sm text-gray-600">
            Everything generated so far — videos, captions, thumbnails and published packages — kept here so nothing disappears.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleClear}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Clear all
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No deliverables yet. Generate a video, burn captions, or publish a package and it will appear here.
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
                      preload="metadata"
                    />
                  )}

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
