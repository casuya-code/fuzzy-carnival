/** Shared display formatters. */

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtSeconds(seconds: number | undefined | null, digits = 1): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(digits)}s`;
}
