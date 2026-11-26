"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useAuth } from "@/components/AuthProvider";

const NAV = [
  { href: "/", label: "Home", icon: "🏠", desc: "Start here" },
  { href: "/text-to-speech", label: "Speech", icon: "🎙️", desc: "Turn text into audio" },
  { href: "/speech-and-background", label: "Mix Audio", icon: "🎵", desc: "Mix voice with background" },
  { href: "/trimming-and-zooming", label: "Edit Video", icon: "✂️", desc: "Trim and zoom clips" },
  { href: "/animated-captions", label: "Captions", icon: "💬", desc: "Put words on your video" },
  { href: "/publish-package", label: "Publish", icon: "📦", desc: "Thumbnail and short clips" },
  { href: "/history", label: "Files", icon: "🗂️", desc: "Find saved results" },
  { href: "/instruction-manual", label: "Help", icon: "📖", desc: "How to use each tool" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { user, loading, logout } = useAuth();

  const emailInitial = (user?.email || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarStyle = user?.avatar
    ? { backgroundImage: `url("${user.avatar}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

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
              </div>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-hide">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-900"
                      : "border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span className="mt-0.5 text-lg leading-none">{item.icon}</span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
                    <span className="block truncate text-sm font-semibold leading-tight">{item.label}</span>
                    <InfoTip text={item.desc} label={item.label} placement="right" focusable={false} />
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t p-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Tip</span>
                <InfoTip text="Start with Speech, then add music, edit video, and captions." label="Workflow tip" placement="top" />
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1.5">
                {!loading && user ? (
                  <>
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm"
                      style={avatarStyle}
                      title={user.email}
                      aria-label={`Signed in as ${user.email}`}
                    >
                      {!user.avatar && emailInitial}
                    </div>
                    <Link
                      href="/profile"
                      onClick={() => setOpen(false)}
                      className="shrink-0 rounded-lg px-1.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      title="Your profile"
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => { logout(); setOpen(false); }}
                      className="shrink-0 rounded-lg border px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      title={`Log out ${user.email}`}
                    >
                      Log out
                    </button>
                  </>
                ) : !loading ? (
                  <>
                    <Link href="/login" onClick={() => setOpen(false)} className="shrink-0 rounded-lg border px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Log in</Link>
                    <Link href="/signup" onClick={() => setOpen(false)} className="shrink-0 rounded-lg bg-blue-600 px-2 py-1.5 text-xs text-white hover:bg-blue-700">Sign up</Link>
                  </>
                ) : (
                  <span className="text-xs text-gray-500">Checking...</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}