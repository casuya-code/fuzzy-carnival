/* eslint-disable react/no-unescaped-entities */
import InfoTip from "@/components/InfoTip";
import ManualShell from "./ManualShell";

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
  return (
    <ManualShell sections={SECTIONS}>
      <Section id="overview" title="Overview">
        <p>
          Speech and video in a few steps.{" "}
          <InfoTip
            text="Create speech, mix sounds, edit video, add captions, then prepare files."
            label="Overview details"
          />
        </p>
        <ul className="space-y-1.5">
          <Li><b>Create Speech</b> — type text and get spoken audio in English or Swahili.</Li>
          <Li><b>Add Music & Sounds</b> — mix your voice with background music or ambient sound.</Li>
          <Li><b>Edit Video</b> — trim clips, add gentle zoom, and attach your audio.</Li>
          <Li><b>Add Captions — on-screen words</b> <InfoTip text="Words come from your script; audio is not transcribed." label="Add Captions details" /></Li>
          <Li><b>Ready to Post</b> — make a thumbnail and short clips from your final video.</Li>
          <Li><b>My Files — saved videos</b> <InfoTip text="Edited, captioned, thumbnails and packages." label="My Files details" /></Li>
        </ul>
      </Section>

      <Section id="getting-started" title="Getting started">
        <ul className="space-y-1.5">
          <Li>Use the <b>left menu</b> (<b>Menu</b> on phones).</Li>
          <Li>A common order is: <b>Create Speech → Add Music & Sounds → Edit Video → Add Captions → Ready to Post</b>.</Li>
          <Li><b>Saved on this device.</b> <InfoTip text="Videos appear in My Files; speech and mixes stay in audio tools." label="Where files are saved" /></Li>
          <Li><b>Waking up</b> <InfoTip text="The first action may be slow while the service starts." label="Waking up details" /></Li>
        </ul>
      </Section>

      <Section id="tts" title="Create Speech">
        <p>Turn written text into natural-sounding audio.</p>
        <ul className="space-y-1.5">
          <Li><b>Choose a language:</b> English or Swahili.</Li>
          <Li><b>Voice sample (optional): 10–15s of clear speech.</b> <InfoTip text="Supported voices can clone that sample." label="Voice sample details" /></Li>
          <Li><b>Choose a voice: clone or preset.</b> <InfoTip text="Some voices use your sample; others use a preset or online voice." label="Voice options" /></Li>
          <Li><b>Project name: file label.</b> <InfoTip text="Used to name saved files for easier lookup." label="Project name details" /></Li>
          <Li><b>Speaking pace: Slower / Natural / Faster.</b> <InfoTip text="Slower adds pauses for narration; Faster compresses delivery." label="Speaking pace details" /></Li>
          <Li><b>Enter your text:</b> type or paste what you want to hear, then click <b>Create speech</b>.</Li>
          <Li><b>Tip: punctuation sets the pauses.</b> <InfoTip text="Full stops, commas and paragraph breaks control pacing; keep sentences under ~15 words." label="Punctuation tip" /></Li>
          <Li><b>Swahili: spell out numbers, end with a period.</b> <InfoTip text="Missing full stops cause run-on reading." label="Swahili tip" /></Li>
          <Li><b>Tip: every click makes a fresh take.</b> <InfoTip text="Preview or download any take." label="Fresh takes" /></Li>
        </ul>
      </Section>

      <Section id="speech-bg" title="Add Music & Sounds">
        <p>Combine your voice with background music or ambient sounds in one audio file.</p>
        <ul className="space-y-1.5">
          <Li><b>Voice (main): your recording.</b> <InfoTip text="The final length usually follows this track." label="Main voice details" /></Li>
          <Li><b>Background sound (optional):</b> add ambience like nature or crowd sounds.</Li>
          <Li><b>Music: auto-lowered while speaking.</b> <InfoTip text="Background music ducks under speech for clarity." label="Music details" /></Li>
          <Li><b>Save layers, then Mix &amp; export.</b> <InfoTip text="Saved audio can be reused; mixing produces the final file." label="Mixing details" /></Li>
        </ul>
      </Section>

      <Section id="trimming" title="Edit Video">
        <p>Prepare your video clips and attach your audio.</p>
        <ul className="space-y-1.5">
          <Li><b>Add clips:</b> upload one or more video clips.</Li>
          <Li><b>Trim ends: cut clip tails.</b> <InfoTip text="Especially useful for AI-generated clips." label="Trim ends details" /></Li>
          <Li><b>Pick platform:</b> Shorts, Feed or YouTube sets the shape.</Li>
          <Li><b>Transitions &amp; sounds:</b> pick a cut style and optional local SFX. <InfoTip text="Sounds are generated at each cut; no stock audio is downloaded." label="Transition sounds" /></Li>
          <Li><b>Local overlay:</b> add your own image badge. <InfoTip text="PNG, JPG or WebP. It stays local until render." label="Local overlay" /></Li>
          <Li><b>Add audio:</b> use an uploaded audio file or one from your saved speech/mix results.</Li>
          <Li>When ready, process the video and download or reuse the result in the next steps.</Li>
        </ul>
      </Section>

      <Section id="captions" title="Add Captions">
        <p><b>Captions from your script.</b> <InfoTip text="The app does not transcribe audio automatically." label="Captions details" /></p>
        <ul className="space-y-1.5">
          <Li><b>Choose your video:</b> upload a video or pick one from your saved files.</Li>
          <Li><b>Script: paste the exact spoken words.</b> <InfoTip text="Load a saved script; timings are re-estimated from script and duration." label="Script details" /></Li>
          <Li><b>Adjust timing: delays, ratio, chunk size.</b> <InfoTip text="Font, colors, outline and position are fixed by the preset." label="Timing details" /></Li>
          <Li><b>Preview first:</b> check the timing table, then create the final video with captions burned in.</Li>
        </ul>
      </Section>

      <Section id="publish" title="Ready to Post">
        <p>Create a thumbnail and short vertical clips from your finished video.</p>
        <ul className="space-y-1.5">
          <Li><b>Choose your final video:</b> pick from saved files or upload one.</Li>
          <Li><b>Thumbnail:</b> customize the main text and style, then preview or create it.</Li>
          <Li><b>Short clips: vertical highlights.</b></Li>
          <Li>Download the files you need, or save the package to <b>My Files</b>.</Li>
        </ul>
      </Section>

      <Section id="history" title="My Files">
        <p>
          <b>My Files: saved videos on this device.</b>{" "}
          <InfoTip
            text="Grouped by type; preview, open, download or remove items. Speech and mixes stay in audio tools."
            label="My Files details"
          />
        </p>
        <p className="text-gray-600">
          <b>Download files to keep them.</b>{" "}
          <InfoTip text="The list is device/browser-local and may be cleared." label="Download advice" />
        </p>
      </Section>

      <Section id="troubleshooting" title="Tips & Fixes">
        <ul className="space-y-1.5">
          <Li><b>Slow at first</b> <InfoTip text="The service may be waking up. Give it a moment and try again." label="Slow start details" /></Li>
          <Li><b>Upload problems:</b> check that the file type is supported and try a smaller file if needed.</Li>
          <Li><b>Voice copy off</b> <InfoTip text="Record 10–15 seconds of clear speech (one person, quiet room) and try again." label="Voice copy details" /></Li>
          <Li><b>Captions don’t match:</b> make sure the selected audio matches what is spoken in the video.</Li>
          <Li><b>Missing files</b> <InfoTip text="Downloads are the safest way to keep your finished work." label="Missing files details" /></Li>
          <Li><b>Swahili rushed</b> <InfoTip text="Lower the Speaking pace slider and add a period at the end of every sentence." label="Swahili pacing details" /></Li>
        </ul>
      </Section>

      <Section id="updates" title="What's New">
        <ul className="space-y-1.5">
          <Li><b>Pace control</b> <InfoTip text="A slider in Create Speech changes delivery speed without rewriting text (Slower / Natural / Faster)." label="Pace control details" /></Li>
          <Li><b>Smarter pauses</b> <InfoTip text="The reader breathes after sentences, pauses at commas, and waits longer at paragraph breaks." label="Smarter pauses details" /></Li>
          <Li><b>Swahili clean-up</b> <InfoTip text="Numbers, dates and times become spoken Swahili; missing full stops are added so passages do not run on." label="Swahili clean-up details" /></Li>
          <Li><b>File naming</b> <InfoTip text="Saved files use your project name and a date folder so they sort logically." label="File naming details" /></Li>
          <Li><b>My Files</b> <InfoTip text="Edited videos, captions, thumbnails and publish packages in one place; speech and mixes stay in audio tools." label="My Files details" /></Li>
        </ul>
      </Section>
    </ManualShell>
  );
}