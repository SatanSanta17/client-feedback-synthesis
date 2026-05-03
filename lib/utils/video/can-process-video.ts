export type VideoCapabilityResult =
  | { ok: true }
  | { ok: false; reason: string };

export function canProcessVideoInBrowser(): VideoCapabilityResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "server" };
  }
  if (typeof Worker === "undefined") {
    return { ok: false, reason: "Web Worker not supported" };
  }
  if (typeof WebAssembly === "undefined") {
    return { ok: false, reason: "WebAssembly not supported" };
  }

  const probe = document.createElement("video");
  if (typeof probe.canPlayType !== "function") {
    return { ok: false, reason: "video element not supported" };
  }

  return { ok: true };
}
