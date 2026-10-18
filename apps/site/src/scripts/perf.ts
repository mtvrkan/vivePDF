const STORE = "vp-lite";
const forcedFull = () => new URLSearchParams(location.search).has("full");

export const isLite = () => document.documentElement.classList.contains("lite");

export function enableLite() {
  if (isLite() || forcedFull()) return;
  document.documentElement.classList.add("lite");
  dispatchEvent(new Event("vp:lite"));
  try {
    localStorage.setItem(STORE, String(Date.now()));
  } catch {}
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

export function framesAreSlow(frames: number, slowFrames: number, duration: number): boolean {
  return frames < (duration / 1000) * 40 || slowFrames > frames * 0.15;
}

function sample(duration: number): Promise<boolean> {
  return new Promise((resolve) => {
    let start = 0;
    let last = 0;
    let frames = 0;
    let slowFrames = 0;
    const step = (t: number) => {
      if (document.hidden) return resolve(false);
      if (!start) start = t;
      else {
        frames++;
        if (t - last > 50) slowFrames++;
      }
      last = t;
      if (t - start < duration) requestAnimationFrame(step);
      else resolve(framesAreSlow(frames, slowFrames, t - start));
    };
    requestAnimationFrame(step);
  });
}

export function watchPerformance() {
  if (isLite() || forcedFull()) return;
  const check = (duration: number) =>
    sample(duration).then((slow) => {
      if (slow) enableLite();
    });
  const afterLoad = () =>
    setTimeout(() => {
      if (softwareRendering()) enableLite();
      else check(2500);
    }, 1500);
  if (document.readyState === "complete") afterLoad();
  else addEventListener("load", afterLoad, { once: true });
  addEventListener(
    "scroll",
    () => {
      if (!isLite()) check(2000);
    },
    { once: true, passive: true },
  );
}
