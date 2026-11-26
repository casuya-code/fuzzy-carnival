"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useAuth } from "@/components/AuthProvider";
import { getAccountStats } from "@/lib/api";

const tools = [
  {
    href: "/text-to-speech",
    icon: "🎙️",
    title: "Speech",
    desc: "Text → audio, with voice samples.",
    tip: "Type text and turn it into spoken audio in English or Swahili. You can also add a voice sample.",
    step: "1",
  },
  {
    href: "/speech-and-background",
    icon: "🎵",
    title: "Mix Audio",
    desc: "Voice + music or sounds.",
    tip: "Mix your voice with background music or sounds to make it more engaging.",
    step: "2",
  },
  {
    href: "/trimming-and-zooming",
    icon: "✂️",
    title: "Edit Video",
    desc: "Trim, zoom, and attach audio.",
    tip: "Trim video clips, add gentle zoom, and attach your audio.",
    step: "3",
  },
  {
    href: "/animated-captions",
    icon: "💬",
    title: "Captions",
    desc: "Add readable on-screen words.",
    tip: "Put easy-to-read words on your video so people can follow along.",
    step: "4",
  },
  {
    href: "/publish-package",
    icon: "📦",
    title: "Publish",
    desc: "Thumbnail + Shorts, ready to post.",
    tip: "Create a thumbnail and short clips so your video is ready to share.",
    step: "5",
  },
  {
    href: "/history",
    icon: "🗂️",
    title: "Files",
    desc: "Recent audio and video results.",
    tip: "Find your recent audio and video results in one place.",
    step: "∞",
  },
  {
    href: "/instruction-manual",
    icon: "📖",
    title: "Help",
    desc: "Short guide for each tool.",
    tip: "Simple instructions and tips for using each tool.",
    step: "?",
  },
];

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [totalUsers, setTotalUsers] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getAccountStats()
      .then((stats) => { if (active) setTotalUsers(stats.total_users); })
      .catch(() => { if (active) setTotalUsers(null); });
    return () => { active = false; };
  }, [user?.id]);

  const initial = (user?.email || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarStyle = user?.avatar
    ? { backgroundImage: `url("${user.avatar}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  return (
    <div className="space-y-6 py-2 sm:py-4">
      <section className="rounded-2xl border bg-white p-5 sm:p-7 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Yakodonyo Studio</h1>
          <InfoTip text="Create speech and videos in a few easy steps. Use the menu or pick a tool below." label="About" />
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700"
            title="Registered accounts"
          >
            <span aria-hidden="true">👥</span>
            {totalUsers === null ? "…" : totalUsers.toLocaleString()} {totalUsers === 1 ? "user" : "users"}
          </span>
        </div>
        <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">Speech and video, in a few steps.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 text-sm w-full">
          <span className="flex items-center justify-center rounded-full bg-blue-50 px-2 sm:px-3 py-2 text-blue-700 font-medium text-center">Easy</span>
          <span className="flex items-center justify-center rounded-full bg-emerald-50 px-2 sm:px-3 py-2 text-emerald-700 font-medium text-center">EN &amp; SW</span>
          <span className="flex items-center justify-center rounded-full bg-gray-100 px-2 sm:px-3 py-2 text-gray-700 font-medium text-center">Save &amp; download</span>
        </div>
        {!loading && !user ? (
          <div className="mt-5 grid w-full grid-cols-2 gap-3 border-t border-gray-100 pt-5">
            <Link
              href="/signup"
              className="flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Create account
            </Link>
            <Link
              href="/login"
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Log in
            </Link>
          </div>
        ) : !loading && user ? (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-green-100 bg-green-50/70 p-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm"
              style={avatarStyle}
              title={user.email}
              aria-label={`Signed in as ${user.email}`}
            >
              {!user.avatar && initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                Active now
              </div>
              <div className="truncate text-sm font-semibold text-green-900">{user.name || user.email}</div>
              {user.name && (
                <div className="truncate text-xs text-green-700" title={user.email}>{user.email}</div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href="/profile"
                className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Profile
              </Link>
              <button
                onClick={logout}
                className="rounded-lg border border-green-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Log out
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Tools</h2>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span>Also in menu</span>
            <InfoTip text="Every tool is also reachable from the left menu." label="Menu" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group rounded-xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-2xl">{t.icon}</div>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">{t.step}</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <h3 className="text-lg font-semibold text-gray-900">{t.title}</h3>
                <InfoTip text={t.tip} label={t.title} placement="bottom" focusable={false} />
              </div>
              <p className="mt-1.5 text-sm text-gray-600">{t.desc}</p>
              <span className="mt-4 inline-flex items-center text-sm font-medium text-blue-600 group-hover:text-blue-700">Open →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-blue-900">Start with Speech</h2>
        <InfoTip text="Then add music, edit video, add captions, and prepare files for posting." label="Suggested workflow" />
      </section>
    </div>
  );
}