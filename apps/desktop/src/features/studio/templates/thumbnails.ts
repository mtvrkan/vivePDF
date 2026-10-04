import { useEffect, useState } from "react";
import { studioThumbnail } from "@/shared/rpc/operations";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import type { StudioPage } from "@/types/studio";
import { measureTexts } from "../design/measure";
import { pageToRender } from "../model/render";
import { thumbnailPage, thumbnailSide } from "./thumbnailPage";

const CONCURRENCY = 2;

export type ThumbnailState = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

type Job = { key: string; page: () => StudioPage; language: string; side: number; wanted: number; promise: Promise<string>; resolve: (url: string) => void; reject: (error: unknown) => void };

const ready = new Map<string, string>();
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function render(job: Job): Promise<string> {
  const page = thumbnailPage(job.page());
  const measured = await measureTexts(page.elements, job.language);
  const result = await studioThumbnail({ page: pageToRender(page, measured), language: job.language, side: job.side });
  return URL.createObjectURL(new Blob([decode(result.image)], { type: "image/jpeg" }));
}

function pump() {
  while (running < CONCURRENCY) {
    const job = queue.shift();
    if (!job) return;
    if (job.wanted <= 0) {
      jobs.delete(job.key);
      continue;
    }
    running += 1;
    render(job)
      .then((url) => {
        ready.set(job.key, url);
        job.resolve(url);
      }, job.reject)
      .finally(() => {
        jobs.delete(job.key);
        running -= 1;
        pump();
      });
  }
}

function request(key: string, page: () => StudioPage, language: string, side: number): Job {
  const known = jobs.get(key);
  if (known) {
    known.wanted += 1;
    return known;
  }
  let resolve: (url: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const job: Job = { key, page, language, side, wanted: 1, promise, resolve, reject };
  jobs.set(key, job);
  queue.push(job);
  pump();
  return job;
}

export function useTemplateThumbnail(id: string, page: (() => StudioPage) | null, language: string, box: number): ThumbnailState {
  const revision = useFontLibraryStore((state) => state.revision);
  const key = `${id}|${language}|${thumbnailSide(box)}|${revision}`;
  const [state, setState] = useState<{ key: string; value: ThumbnailState }>(() => ({ key, value: ready.has(key) ? { status: "ready", url: ready.get(key) ?? "" } : { status: "loading" } }));
  const cached = ready.get(key);
  const current: ThumbnailState = cached ? { status: "ready", url: cached } : state.key === key ? state.value : { status: "loading" };

  useEffect(() => {
    if (!page || ready.has(key)) return;
    let live = true;
    const job = request(key, page, language, thumbnailSide(box));
    job.promise.then(
      (url) => {
        if (live) setState({ key, value: { status: "ready", url } });
      },
      () => {
        if (live) setState({ key, value: { status: "error" } });
      },
    );
    return () => {
      live = false;
      job.wanted -= 1;
    };
  }, [key, page, language, box]);

  return current;
}
