import { useEffect, useMemo, useState } from "react";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { readDocumentBytes } from "@/shared/rpc/files";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { OrganizerSource, OrganizerTile, PageSize } from "@/types";
import { sourcesInUse } from "./analyzedSelection";
import { MAIN_SOURCE_ID, useOrganizerStore } from "./organizerStore";
import { imagePageSize, type KnownSizes, type Size } from "./pageShapes";
import { thumbnails } from "./thumbnailCache";

const pageSizesByFile = new Map<string, readonly PageSize[] | null>();
const imageSizesByPath = new Map<string, Size | null>();

const fileKey = (source: OrganizerSource) => `${source.path}|${source.pageCount}`;

async function imagePixels(tile: Extract<OrganizerTile, { kind: "image" }>): Promise<Size> {
  const known = tile.previewUrl || thumbnails.recall(`image:${tile.path}`);
  const url = known || URL.createObjectURL(new Blob([await readDocumentBytes(tile.path)]));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    if (!known) URL.revokeObjectURL(url);
  }
}

function wantedOf(tiles: OrganizerTile[], sources: Record<string, OrganizerSource>) {
  const pdfs = sourcesInUse(tiles)
    .filter((id) => id !== MAIN_SOURCE_ID)
    .map((id) => sources[id])
    .filter((source): source is OrganizerSource => source !== undefined);
  const images = new Map<string, Extract<OrganizerTile, { kind: "image" }>>();
  for (const tile of tiles) if (tile.kind === "image" && !images.has(tile.path)) images.set(tile.path, tile);
  return { pdfs, images: [...images.values()] };
}

export function usePageSizes(): KnownSizes {
  const documentId = useOrganizerStore((state) => state.documentId);
  const tiles = useOrganizerStore((state) => state.tiles);
  const sources = useOrganizerStore((state) => state.sources);
  const mainSizes = useDocumentStore((state) => (documentId ? state.documents[documentId]?.info?.pageSizes : undefined));
  const [cache, setCache] = useState(() => ({ pdfs: new Map(pageSizesByFile), images: new Map(imageSizesByPath) }));
  const wanted = useMemo(() => wantedOf(tiles, sources), [tiles, sources]);
  const missing = wanted.pdfs.filter((source) => !pageSizesByFile.has(fileKey(source))).length + wanted.images.filter((tile) => !imageSizesByPath.has(tile.path)).length;

  useEffect(() => {
    if (missing === 0) return;
    let cancelled = false;
    void (async () => {
      for (const source of wanted.pdfs) {
        if (cancelled) return;
        if (pageSizesByFile.has(fileKey(source))) continue;
        const sizes = await getDocumentInfo({ path: source.path, password: source.password ?? undefined }).then(
          (info) => info.pageSizes,
          () => null,
        );
        pageSizesByFile.set(fileKey(source), sizes);
      }
      for (const tile of wanted.images) {
        if (cancelled) return;
        if (imageSizesByPath.has(tile.path)) continue;
        const size = await imagePixels(tile).then(imagePageSize, () => null);
        imageSizesByPath.set(tile.path, size);
      }
      if (!cancelled) setCache({ pdfs: new Map(pageSizesByFile), images: new Map(imageSizesByPath) });
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, missing]);

  return useMemo(() => {
    const pages = new Map<string, readonly PageSize[]>();
    if (mainSizes) pages.set(MAIN_SOURCE_ID, mainSizes);
    for (const source of wanted.pdfs) {
      const sizes = cache.pdfs.get(fileKey(source));
      if (sizes) pages.set(source.id, sizes);
    }
    const images = new Map<string, Size>();
    for (const tile of wanted.images) {
      const size = cache.images.get(tile.path);
      if (size) images.set(tile.path, size);
    }
    return { pages, images };
  }, [mainSizes, wanted, cache]);
}
