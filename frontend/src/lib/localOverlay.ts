/** A user-supplied image badge composited into the final video render. */
export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export const DEFAULT_OVERLAY_POSITION: OverlayPosition = "bottom-right";
export const DEFAULT_OVERLAY_SIZE = 18;
export const DEFAULT_OVERLAY_OPACITY = 100;

export const OVERLAY_POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
  { id: "center", label: "Center" },
];

export const OVERLAY_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
