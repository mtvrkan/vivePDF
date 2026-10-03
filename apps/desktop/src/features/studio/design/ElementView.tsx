import { ImageOff } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StudioElement, StudioImageElement, StudioPage, StudioQrElement, StudioRenderPath, StudioSvgElement, StudioTextElement } from "@/types/studio";
import { elementItems } from "../model/render";
import { renderFill, roundedRect } from "../model/shapes";
import { qrPath, useImagePreview, useQrModules } from "./assets";
import { ensureElementFonts, useStudioFontsStore } from "./fonts";
import { placeImage } from "./imageLayout";
import { fitTextSize } from "./measure";
import { runCss, runData, textBodyStyle, textFrameStyle } from "./textStyle";

export function PathsSvg({ paths, width, height }: { paths: StudioRenderPath[]; width: number; height: number }) {
  const prefix = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        {paths.map((path, index) => {
          const fill = path.fill;
          if (!fill || fill.type === "solid") return null;
          const stops = fill.stops.map((stop, stopIndex) => <stop key={stopIndex} offset={stop.offset} stopColor={stop.color} />);
          return fill.type === "linear" ? (
            <linearGradient key={index} id={`${prefix}g${index}`} gradientUnits="userSpaceOnUse" x1={fill.x1} y1={fill.y1} x2={fill.x2} y2={fill.y2}>
              {stops}
            </linearGradient>
          ) : (
            <radialGradient key={index} id={`${prefix}g${index}`} gradientUnits="userSpaceOnUse" cx={fill.cx} cy={fill.cy} r={fill.r}>
              {stops}
            </radialGradient>
          );
        })}
      </defs>
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={!path.fill ? "none" : path.fill.type === "solid" ? path.fill.color : `url(#${prefix}g${index})`}
          fillRule={path.evenOdd ? "evenodd" : "nonzero"}
          stroke={path.stroke?.color ?? "none"}
          strokeWidth={path.stroke?.width}
          strokeDasharray={path.stroke?.dash.length ? path.stroke.dash.join(" ") : undefined}
          strokeLinecap={path.stroke?.cap}
          strokeLinejoin={path.stroke?.join}
          strokeMiterlimit={4}
          opacity={path.opacity < 1 ? path.opacity : undefined}
        />
      ))}
    </svg>
  );
}

export function TextContent({ element, language, bodyRef, editable }: { element: StudioTextElement; language: string; bodyRef?: React.RefObject<HTMLDivElement | null>; editable?: ReactNode }) {
  const faces = useStudioFontsStore((state) => state.faces);
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = bodyRef ?? ownRef;
  const [size, setSize] = useState(element.fontSize);

  useEffect(() => {
    void ensureElementFonts([element]);
  }, [element]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    setSize(element.shrinkToFit ? fitTextSize(ref.current, element) : element.fontSize);
  }, [element, faces, ref]);

  return (
    <div lang={language} style={textFrameStyle(element)}>
      {editable ?? (
        <div ref={ref} style={textBodyStyle(element, size)}>
          {element.runs.map((run, index) => (
            <span key={index} {...runData(element, run)} style={runCss(element, run, faces)}>
              {run.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageContent({ element }: { element: StudioImageElement }) {
  const preview = useImagePreview(element.src);
  const ready = preview?.status === "ready" ? preview.value : null;
  const radius = element.mask === "circle" ? "50%" : element.mask === "rounded" ? `${element.cornerRadius}px` : undefined;
  const stroke = elementItems({ ...element, hidden: false, opacity: 1 })[1];
  if (preview?.status === "error") {
    return (
      <div data-image-state="error" className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground" style={{ borderRadius: radius }}>
        <ImageOff className="size-1/3 max-h-12 max-w-12" aria-hidden />
      </div>
    );
  }
  if (!ready) {
    return <div data-image-state="loading" className="h-full w-full animate-pulse bg-muted" style={{ borderRadius: radius }} />;
  }
  const placed = placeImage(ready, element.crop, element.fit, element);
  return (
    <>
      <div style={{ position: "absolute", ...px(placed.frame), overflow: "hidden", borderRadius: radius }}>
        <img src={ready.url} alt="" draggable={false} style={{ position: "absolute", maxWidth: "none", ...px(placed.image) }} />
      </div>
      {stroke?.kind === "vector" ? (
        <div style={{ position: "absolute", inset: 0 }}>
          <PathsSvg paths={stroke.paths} width={element.width} height={element.height} />
        </div>
      ) : null}
    </>
  );
}

function px(box: { left: number; top: number; width: number; height: number }) {
  return { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` };
}

function QrContent({ element }: { element: StudioQrElement }) {
  const modules = useQrModules(element.value || " ", element.errorLevel);
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${element.width} ${element.height}`} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      {element.background ? <rect width={element.width} height={element.height} fill={element.background} /> : null}
      {modules.status === "ready" ? <path d={qrPath(modules.value, element.width, element.height)} fill={element.color} /> : null}
    </svg>
  );
}

function SvgContent({ element }: { element: StudioSvgElement }) {
  return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(element.svg)}`} alt="" draggable={false} style={{ display: "block", width: "100%", height: "100%" }} />;
}

function ElementContent({ element, language }: { element: StudioElement; language: string }) {
  switch (element.kind) {
    case "text":
      return <TextContent element={element} language={language} />;
    case "image":
      return <ImageContent element={element} />;
    case "qr":
      return <QrContent element={element} />;
    case "svg":
      return <SvgContent element={element} />;
    default: {
      const item = elementItems({ ...element, hidden: false, opacity: 1 })[0];
      if (!item || item.kind !== "vector") return null;
      return <PathsSvg paths={item.paths} width={item.viewWidth ?? element.width} height={item.viewHeight ?? element.height} />;
    }
  }
}

function elementFrameStyle(element: StudioElement): React.CSSProperties {
  return {
    position: "absolute",
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    opacity: element.opacity < 1 ? element.opacity : undefined,
  };
}

export const ElementView = memo(function ElementView({ element, language, children }: { element: StudioElement; language: string; children?: ReactNode }) {
  return (
    <div data-element-id={element.id} style={elementFrameStyle(element)}>
      {children ?? <ElementContent element={element} language={language} />}
    </div>
  );
});

function BackgroundView({ page }: { page: StudioPage }) {
  const fill = renderFill(page.background.fill, page.width, page.height);
  const image = page.background.image;
  const preview = useImagePreview(image?.src ?? null);
  const ready = preview?.status === "ready" ? preview.value : null;
  const placed = ready && image ? placeImage(ready, { x: 0, y: 0, width: 1, height: 1 }, image.fit, page) : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "white" }} aria-hidden>
      {fill ? <PathsSvg paths={[{ d: roundedRect(0, 0, page.width, page.height, 0), fill, stroke: null, evenOdd: false, opacity: 1 }]} width={page.width} height={page.height} /> : null}
      {placed && ready && image ? (
        <div style={{ position: "absolute", ...px(placed.frame), overflow: "hidden", opacity: image.opacity }}>
          <img src={ready.url} alt="" draggable={false} style={{ position: "absolute", maxWidth: "none", ...px(placed.image) }} />
        </div>
      ) : null}
    </div>
  );
}

export function PageView({ page, language, renderElement }: { page: StudioPage; language: string; renderElement?: (element: StudioElement) => ReactNode }) {
  return (
    <div style={{ position: "relative", width: `${page.width}px`, height: `${page.height}px`, overflow: "hidden" }}>
      <BackgroundView page={page} />
      {page.elements.map((element) => (element.hidden ? null : renderElement ? renderElement(element) : <ElementView key={element.id} element={element} language={language} />))}
    </div>
  );
}
