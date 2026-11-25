import Link from "next/link";
import InfoTip from "@/components/InfoTip";

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
  return (
    <div className="space-y-6 py-2 sm:py-4">
      <section className="rounded-2xl border bg-white p-5 sm:p-7 shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Yakodonyo Studio</h1>
          <InfoTip text="Create speech and videos in a few easy steps. Use the menu or pick a tool below." label="About" />
        </div>
        <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">Speech and video, in a few steps.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 text-sm w-full">
          <span className="flex items-center justify-center rounded-full bg-blue-50 px-2 sm:px-3 py-2 text-blue-700 font-medium text-center">Easy</span>
          <span className="flex items-center justify-center rounded-full bg-emerald-50 px-2 sm:px-3 py-2 text-emerald-700 font-medium text-center">EN &amp; SW</span>
          <span className="flex items-center justify-center rounded-full bg-gray-100 px-2 sm:px-3 py-2 text-gray-700 font-medium text-center">Save &amp; download</span>
        </div>
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