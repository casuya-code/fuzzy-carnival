import Link from "next/link";

const tools = [
  {
    href: "/text-to-speech",
    icon: "🎙️",
    title: "Text-to-Speech",
    desc: "Clone voices and generate speech in English & Swahili with noise-reduced, stable processing.",
  },
  {
    href: "/speech-and-background",
    icon: "🎵",
    title: "Speech-and-Background",
    desc: "Stack L1 voiceover with L2 ambient texture and L3 auto-ducked music, then export a mixed track.",
  },
  {
    href: "/trimming-and-zooming",
    icon: "✂️",
    title: "Trimming & Zooming",
    desc: "Trim AI warp tails, apply 2.5s dynamic retention zoom, stitch clips, and attach unified audio.",
  },
  {
    href: "/animated-captions",
    icon: "💬",
    title: "Animated Captions",
    desc: "Burn karaoke-style word-by-word captions into 9:16 video with platform-safe zones and no extra AI.",
  },
  {
    href: "/publish-package",
    icon: "📦",
    title: "Publish Package",
    desc: "Auto-design a YouTube thumbnail and slice 3 vertical Shorts — 5 ready-to-post files in one click.",
  },
  {
    href: "/history",
    icon: "🗂️",
    title: "History",
    desc: "All generated videos, captions, thumbnails and published packages — persisted so nothing disappears.",
  },
  {
    href: "/instruction-manual",
    icon: "📖",
    title: "Instruction Manual",
    desc: "Step-by-step guide to every tool, option, and setting in Yakodonyo Studio.",
  },
];

export default function Home() {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Welcome to Yakodonyo Studio</h1>
        <p className="mt-2 text-gray-600">
          Your bilingual voice &amp; video toolkit. Choose a tool from the sidebar to get started.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <div className="text-2xl mb-2">{t.icon}</div>
            <h2 className="text-lg font-semibold">{t.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{t.desc}</p>
            <span className="mt-3 inline-block text-sm font-medium text-blue-600">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}