import { lazy, Suspense, type ComponentProps } from "react";
import type { TemplateGallery as Gallery } from "./TemplateGallery";

const TemplateGallery = lazy(() => import("./TemplateGallery").then((module) => ({ default: module.TemplateGallery })));

const PLACEHOLDERS = 8;

type GalleryProps = ComponentProps<typeof Gallery>;

function GallerySkeleton({ box, className }: Pick<GalleryProps, "box" | "className">) {
  return (
    <div aria-busy className={className}>
      <div className="flex animate-pulse flex-wrap gap-3">
        {Array.from({ length: PLACEHOLDERS }, (_, index) => (
          <div key={index} className="rounded-md bg-muted" style={{ width: box, height: box }} />
        ))}
      </div>
    </div>
  );
}

export function LazyTemplateGallery(props: GalleryProps) {
  return (
    <Suspense fallback={<GallerySkeleton box={props.box} className={props.className} />}>
      <TemplateGallery {...props} />
    </Suspense>
  );
}
