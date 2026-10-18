import { FOOTNOTE_PICTURE, FOOTNOTE_PICTURE_SIDE, MAX_FOOTNOTE_PICTURE } from "./footnotes";

function shrunk(src: string, side: number): Promise<string> {
  return new Promise((resolve) => {
    const picture = new window.Image();
    picture.onload = () => {
      const scale = Math.min(1, side / Math.max(picture.naturalWidth, picture.naturalHeight, 1));
      if (scale >= 1) return resolve(src);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(src);
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL(src.startsWith("data:image/png") ? "image/png" : "image/jpeg", 0.9));
    };
    picture.onerror = () => resolve(src);
    picture.src = src;
  });
}

export function acceptedPicture(src: string): string | null {
  return FOOTNOTE_PICTURE.test(src) && src.length <= MAX_FOOTNOTE_PICTURE ? src : null;
}

export async function footnotePicture(src: string): Promise<string | null> {
  if (!FOOTNOTE_PICTURE.test(src)) return null;
  return acceptedPicture(await shrunk(src, FOOTNOTE_PICTURE_SIDE));
}
