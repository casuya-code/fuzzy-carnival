import Link from "next/link";

const tools = [
  {
    href: "/text-to-speech",
    icon: "🎙️",
    title: "Create Speech",
    desc: "Type your text and turn it into spoken audio in English or Swahili. You can also use a voice sample.",
    step: "Step 1",
  },
  {
    href: "/speech-and-background",
    icon: "🎵",
    title: "Add Music & Sounds",
    desc: "Mix your voice with background music or sounds to make it more engaging.",
    step: "Step 2",
  },
  {
    href: "/trimming-and-zooming",
    icon: "✂️",
    title: "Edit Video",
    desc: "Trim your video clips, add gentle zoom, and attach your audio.",
    step: "Step 3",
  },
  {
    href: "/animated-captions",
    icon: "💬",
    title: "Add Captions",
    desc: "Put easy-to-read words on your video so people can follow along.",
    step: "Step 4",
  },
  {
    href: "/publish-package",
    icon: "📦",
    title: "Ready to Post",
    desc: "Create a thumbnail and short clips so your video is ready to share.",
    step: "Step 5",
  },
  {
    href: "/history",
    icon: "🗂️",
    title: "My Files",
    desc: "Find your recent audio and video results in one place.",
    step: "Anytime",
  },
  {
    href: "/instruction-manual",
    icon: "📖",
    title: "Help Guide",
    desc: "Simple instructions and tips for using each tool.",
    step: "Help",
  },
];

export default function Home() {
  return (
    <div className="space-y-6 py-2 sm:py-4">
      <section className="rounded-2xl border bg-white p-5 sm:p-7 shadow-sm">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Welcome to Yakodonyo Studio</h1>
        <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
          Create speech and videos in a few easy steps. Use the menu on the left to move between tools, or pick one below to begin.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 font-medium">Easy to use</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 font-medium">English & Swahili</span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700 font-medium">Save and download your work</span>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Choose what you want to do</h2>
          <span className="text-sm text-gray-500">All tools are in the menu too</span>
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
              <h3 className="mt-3 text-lg font-semibold text-gray-900">{t.title}</h3>
              <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{t.desc}</p>
              <span className="mt-4 inline-flex items-center text-sm font-medium text-blue-600 group-hover:text-blue-700">Open tool →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-blue-900">Not sure where to start?</h2>
        <p className="mt-1 text-sm text-blue-900/80">Most people start with <strong>Create Speech</strong>. After that, you can add music, edit your video, add captions, and prepare files for posting.</p>
      </section>
    </div>
  );
}