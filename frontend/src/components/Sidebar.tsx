"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Home", icon: "🏠", desc: "Start here" },
  { href: "/text-to-speech", label: "Create Speech", icon: "🎙️", desc: "Turn text into audio" },
  { href: "/speech-and-background", label: "Add Music & Sounds", icon: "🎵", desc: "Mix voice with background" },
  { href: "/trimming-and-zooming", label: "Edit Video", icon: "✂️", desc: "Trim and zoom clips" },
  { href: "/animated-captions", label: "Add Captions", icon: "💬", desc: "Put words on your video" },
  { href: "/publish-package", label: "Ready to Post", icon: "📦", desc: "Thumbnail and short clips" },
  { href: "/history", label: "My Files", icon: "🗂️", desc: "Find saved results" },
  { href: "/instruction-manual", label: "Help Guide", icon: "📖", desc: "How to use each tool" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold shrink-0" aria-hidden="true">Y</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 leading-tight">Yakodonyo Studio</div>
            <div className="text-[11px] text-gray-500 leading-tight">Create speech and videos step by step</div>
          </div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shrink-0"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`group/sidebar fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] transform border-r bg-white transition-transform md:sticky md:top-0 md:h-screen md:w-72 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b px-4 py-4">
            <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white text-base font-bold shadow-sm shrink-0" aria-hidden="true">Y</div>
              <div className="min-w-0">
                <div className="text-lg font-bold text-gray-900 leading-tight">Yakodonyo Studio</div>
                <div className="mt-0.5 text-sm text-gray-600 leading-tight">Create speech and videos step by step</div>
              </div>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-autohide">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-900"
                      : "border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span className="mt-0.5 text-lg leading-none">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{item.label}</span>
                    <span className={`block text-xs mt-0.5 ${active ? "text-blue-700/80" : "text-gray-500"}`}>{item.desc}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t p-4 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-700">Tip</p>
            <p>Start with <span className="font-medium">Create Speech</span>, then add music, edit video, and captions.</p>
          </div>
        </div>
      </aside>
    </>
  );
}