const forcedFull = () => new URLSearchParams(location.search).has("full");

export const isLite = () => document.documentElement.classList.contains("lite");

export function enableLite() {
  if (isLite() || forcedFull()) return;
  document.documentElement.classList.add("lite");
  dispatchEvent(new Event("vp:lite"));
}

let software: boolean | null = null;

export function softwareRendering(): boolean {
  if (software === null) {
    const canvas = document.createElement("canvas");
    const options = { failIfMajorPerformanceCaveat: true };
    const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
    software = !gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return software;
}

export function watchPerformance() {
  if (isLite() || forcedFull()) return;
  const check = () =>
    setTimeout(() => {
      if (softwareRendering()) enableLite();
    }, 1500);
  if (document.readyState === "complete") check();
  else addEventListener("load", check, { once: true });
}
