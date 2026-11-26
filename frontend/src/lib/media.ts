/** Read a file's media duration entirely in the browser (no upload). */
const DURATION_TIMEOUT_MS = 8_000;

export function getMediaDuration(
  file: File,
  kind: "video" | "audio" = "video"
): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(0);
      return;
    }
    const el = document.createElement(kind) as HTMLVideoElement & HTMLAudioElement;
    const url = URL.createObjectURL(file);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      resolve(value);
    };

    timer = setTimeout(() => finish(0), DURATION_TIMEOUT_MS);
    el.preload = "metadata";
    el.onloadedmetadata = () =>
      finish(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => finish(0);
    el.src = url;
  });
}
