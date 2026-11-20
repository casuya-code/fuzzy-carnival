/** Read a file's media duration entirely in the browser (no upload). */
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
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () =>
      finish(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => finish(0);
    el.src = url;
  });
}
