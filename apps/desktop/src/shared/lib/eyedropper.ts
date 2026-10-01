type EyeDropperResult = { sRGBHex: string };

type EyeDropperInstance = { open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult> };

type EyeDropperConstructor = new () => EyeDropperInstance;

function getEyeDropperConstructor(): EyeDropperConstructor | null {
  const candidate = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  return typeof candidate === "function" ? candidate : null;
}

export function isEyeDropperSupported(): boolean {
  return getEyeDropperConstructor() !== null;
}

export async function pickColorFromScreen(): Promise<string | null> {
  const EyeDropperApi = getEyeDropperConstructor();
  if (!EyeDropperApi) return null;
  try {
    const result = await new EyeDropperApi().open();
    return result.sRGBHex;
  } catch {
    return null;
  }
}
