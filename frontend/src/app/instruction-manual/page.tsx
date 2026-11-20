/* eslint-disable react/no-unescaped-entities */
"use client";

import { useState } from "react";

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "getting-started", title: "Getting started" },
  { id: "tts", title: "Create Speech" },
  { id: "speech-bg", title: "Add Music & Sounds" },
  { id: "trimming", title: "Edit Video" },
  { id: "captions", title: "Add Captions" },
  { id: "publish", title: "Ready to Post" },
  { id: "history", title: "My Files" },
  { id: "troubleshooting", title: "Tips & Fixes" },
  { id: "updates", title: "What's New" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
      <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
      <div className="space-y-3 text-sm sm:text-[15px] text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="ml-5 list-disc">{children}</li>;
}

export default function InstructionManualPage() {
  const [query, setQuery] = useState("");
  const filtered = SECTIONS.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <header className="rounded-xl border bg-white p-4 sm:p-6 shadow-sm">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">📖 Help Guide</h1>
        <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
          Simple instructions for each tool. Use the menu on the left to open a tool, or jump to a section below.
        </p>
        <div className="mt-4 max-w-md">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help topics..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-4 self-start rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900 mb-2">Jump to</div>
          <nav className="space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 px-2 py-1">No matching topics.</p>
            ) : (
              filtered.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  {s.title}
                </a>
              ))
            )}
          </nav>
        </aside>

        <div className="space-y-4 sm:space-y-5 min-w-0">
          <Section id="overview" title="Overview">
            <p>
              Yakodonyo Studio helps you create spoken audio and videos in a few easy steps. You can turn text into speech,
              mix in music or sounds, edit video clips, add captions, and prepare files for posting.
            </p>
            <ul className="space-y-1.5">
              <Li><b>Create Speech</b> — type text and get spoken audio in English or Swahili.</Li>
              <Li><b>Add Music & Sounds</b> — mix your voice with background music or ambient sound.</Li>
              <Li><b>Edit Video</b> — trim clips, add gentle zoom, and attach your audio.</Li>
              <Li><b>Add Captions</b> — put words on your video so people can follow along.</Li>
              <Li><b>Ready to Post</b> — make a thumbnail and short clips from your final video.</Li>
              <Li><b>My Files</b> — find your recent results in one place.</Li>
            </ul>
          </Section>

          <Section id="getting-started" title="Getting started">
            <ul className="space-y-1.5">
              <Li>Use the <b>menu on the left</b> to move between tools. On phones, tap <b>Menu</b>.</Li>
              <Li>A common order is: <b>Create Speech → Add Music & Sounds → Edit Video → Add Captions → Ready to Post</b>.</Li>
              <Li>Your results are saved in <b>My Files</b> so you can reuse or download them later (on this device/browser).</Li>
              <Li>If the app says it is waking up, wait a little for the first action to finish.</Li>
            </ul>
          </Section>

          <Section id="tts" title="Create Speech">
            <p>Turn written text into natural-sounding audio.</p>
            <ul className="space-y-1.5">
              <Li><b>Choose a language:</b> English or Swahili.</Li>
              <Li><b>Add a voice sample (optional):</b> record or upload 10–15 seconds of clear speech if you want a voice that sounds like that sample (available for some voice options).</Li>
              <Li><b>Choose a voice:</b> pick the voice that fits your project. Some voices use your sample, others use a preset/online voice.</Li>
              <Li><b>Project name (optional):</b> a short label used to name your saved audio files so they are easy to find later.</Li>
              <Li><b>Speaking pace:</b> drag the slider to change delivery speed. <b>Slower</b> reads more deliberately with longer gaps (good for narration and storytelling), <b>Natural</b> is the default, <b>Faster</b> compresses the delivery. Use this instead of rewriting your text to change the speed.</Li>
              <Li><b>Enter your text:</b> type or paste what you want to hear, then click <b>Create speech</b>.</Li>
              <Li><b>Tip — punctuation controls the breathing:</b> the reader pauses after every sentence, takes a short catch after commas, and leaves a longer beat between paragraphs. For the most natural sound, end sentences with <b>.</b> <b>?</b> or <b>!</b>, keep sentences under about 15 words, and use commas where you would naturally breathe.</Li>
              <Li><b>Swahili tip:</b> write numbers out as words where possible (e.g. <i>mbili</i> not <i>2</i>), and always finish each sentence with a period — Swahili text without a full stop is read as one continuous run-on.</Li>
              <Li><b>Tip:</b> You can preview, download, or create another version. Each new click produces a fresh take.</Li>
            </ul>
          </Section>

          <Section id="speech-bg" title="Add Music & Sounds">
            <p>Combine your voice with background music or ambient sounds in one audio file.</p>
            <ul className="space-y-1.5">
              <Li><b>Voice (main):</b> choose a voice recording you made or upload one. The final length usually follows this voice track.</Li>
              <Li><b>Background sound (optional):</b> add ambience like nature or crowd sounds.</Li>
              <Li><b>Music (optional):</b> add music behind your voice. The app can lower the music while someone is speaking so the voice stays clear.</Li>
              <Li>You can save audio files to your browser library to reuse them later, then click <b>Mix & Export</b> to create the final audio.</Li>
            </ul>
          </Section>

          <Section id="trimming" title="Edit Video">
            <p>Prepare your video clips and attach your audio.</p>
            <ul className="space-y-1.5">
              <Li><b>Add clips:</b> upload one or more video clips.</Li>
              <Li><b>Trim ends:</b> remove a small part from the end of clips if needed (helpful for AI-generated clips).</Li>
              <Li><b>Choose shape:</b> pick vertical, square, or wide format depending on where you will post.</Li>
              <Li><b>Add audio:</b> use an uploaded audio file or one from your saved speech/mix results.</Li>
              <Li>When ready, process the video and download or reuse the result in the next steps.</Li>
            </ul>
          </Section>

          <Section id="captions" title="Add Captions">
            <p>Add on-screen words to your video so viewers can read along.</p>
            <ul className="space-y-1.5">
              <Li><b>Choose your video:</b> upload a video or pick one from your saved files.</Li>
              <Li><b>Choose the audio to transcribe:</b> use the video’s audio or select a different audio track.</Li>
              <Li><b>Adjust style:</b> change text size, colors, and position to keep captions easy to read.</Li>
              <Li><b>Preview first:</b> check how captions look, then create the final video with captions burned in.</Li>
            </ul>
          </Section>

          <Section id="publish" title="Ready to Post">
            <p>Create a thumbnail and short vertical clips from your finished video.</p>
            <ul className="space-y-1.5">
              <Li><b>Choose your final video:</b> pick from saved files or upload one.</Li>
              <Li><b>Thumbnail:</b> customize the main text and style, then preview or create it.</Li>
              <Li><b>Short clips:</b> the app can cut short vertical clips from your main video to help you share highlights.</Li>
              <Li>Download the files you need, or save the package to <b>My Files</b>.</Li>
            </ul>
          </Section>

          <Section id="history" title="My Files">
            <p>
              <b>My Files</b> keeps your recent results on this device/browser, grouped by type. You can preview, open, download, or remove items from the list.
            </p>
            <p className="text-gray-600">If you clear browser data or use a different device/browser, this list may be empty. Download important files to keep them safe.</p>
          </Section>

          <Section id="troubleshooting" title="Tips & Fixes">
            <ul className="space-y-1.5">
              <Li><b>App feels slow at first:</b> the service may be waking up. Give it a moment and try again.</Li>
              <Li><b>Upload problems:</b> check that the file type is supported and try a smaller file if needed.</Li>
              <Li><b>Voice copy doesn’t sound right:</b> record 10–15 seconds of clear speech (one person, quiet room) and try again.</Li>
              <Li><b>Captions don’t match:</b> make sure the selected audio matches what is spoken in the video.</Li>
              <Li><b>Missing files in My Files:</b> downloads are the safest way to keep your finished work.</Li>
              <Li><b>Swahili speech sounds rushed:</b> lower the <b>Speaking pace</b> slider and add a period at the end of every sentence.</Li>
            </ul>
          </Section>

          <Section id="updates" title="What's New">
            <ul className="space-y-1.5">
              <Li><b>Speaking pace control</b> — a slider in Create Speech changes delivery speed without rewriting your text (Slower / Natural / Faster).</Li>
              <Li><b>Smarter pauses</b> — the reader now breathes after sentences, catches briefly at commas, and leaves a longer beat at paragraph breaks, instead of using one flat gap everywhere.</Li>
              <Li><b>Swahili text clean-up</b> — numbers, dates and times are converted to spoken Swahili automatically, and missing end-of-sentence punctuation is added so long passages no longer run on.</Li>
              <Li><b>Standard file naming</b> — saved files are named with your project name and a date folder so they sort logically.</Li>
              <Li><b>My Files</b> — a single place for your recent speech, mixes, edited videos, captions and publish packages.</Li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
