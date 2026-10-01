import { useId, type ReactNode } from "react";
import { DARK_INVERT, pageColorStyle, type PageColorScheme } from "@/shared/lib/pageColors";
import type { PictureArea } from "@/types";
import { darkPageStyle, usePageTone } from "./pageTones";

const INVERT_SLOPE = 1 - 2 * DARK_INVERT;

function KeepPicturesFilter({ id, pictures }: { id: string; pictures: PictureArea[] }) {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <filter id={id} x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feComponentTransfer in="SourceGraphic" result="inverted">
          <feFuncR type="linear" slope={INVERT_SLOPE} intercept={DARK_INVERT} />
          <feFuncG type="linear" slope={INVERT_SLOPE} intercept={DARK_INVERT} />
          <feFuncB type="linear" slope={INVERT_SLOPE} intercept={DARK_INVERT} />
        </feComponentTransfer>
        <feColorMatrix in="inverted" type="hueRotate" values="180" result="dark" />
        {pictures.map((picture, index) => (
          <feFlood key={index} x={picture.x} y={picture.y} width={picture.width} height={picture.height} floodColor="#fff" result={`picture${index}`} />
        ))}
        <feMerge result="pictures">
          {pictures.map((_picture, index) => (
            <feMergeNode key={index} in={`picture${index}`} />
          ))}
        </feMerge>
        <feComposite in="SourceGraphic" in2="pictures" operator="in" result="kept" />
        <feComposite in="dark" in2="pictures" operator="out" result="recoloured" />
        <feMerge>
          <feMergeNode in="recoloured" />
          <feMergeNode in="kept" />
        </feMerge>
      </filter>
    </svg>
  );
}

export function PageBitmap({ documentId, pageIndex, scheme, children }: { documentId: string; pageIndex: number; scheme: PageColorScheme; children: ReactNode }) {
  const filterId = `vivepdf-dark-page-${useId().replace(/[^\w-]/g, "")}`;
  const tone = usePageTone(documentId, pageIndex, scheme === "dark");
  if (scheme === "normal") return <>{children}</>;
  const style = scheme === "dark" ? darkPageStyle(tone, filterId) : pageColorStyle(scheme);
  const pictures = scheme === "dark" && tone && !tone.dark ? tone.pictures : [];
  return (
    <>
      {pictures.length > 0 ? <KeepPicturesFilter id={filterId} pictures={pictures} /> : null}
      <div className="absolute inset-0" style={style} data-page-bitmap={scheme} data-page-tone={scheme === "dark" ? (tone ? (tone.dark ? "dark" : pictures.length > 0 ? "pictures" : "light") : "pending") : undefined}>
        {children}
      </div>
    </>
  );
}
