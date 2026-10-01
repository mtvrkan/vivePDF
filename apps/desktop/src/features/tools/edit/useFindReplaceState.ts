import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { findPreview } from "@/shared/rpc/operations";
import type { FindPreviewResult, SourceDocument, ToastKind } from "@/types";
import { FIND_PREVIEW_LIMIT } from "./editShared";

export function useFindReplaceState(source: SourceDocument | null, pages: string, t: TFunction, toast: (kind: ToastKind, message: string) => void) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findHits, setFindHits] = useState<FindPreviewResult | null>(null);
  const findRequest = useRef(0);
  const [findPreviewing, setFindPreviewing] = useState(false);

  useEffect(() => {
    findRequest.current += 1;
    setFindHits(null);
    setFindPreviewing(false);
  }, [findText, findCaseSensitive, findWholeWord, findRegex, pages, source?.path]);

  const previewFind = async () => {
    if (!source || findText.trim().length === 0) return;
    const request = ++findRequest.current;
    setFindPreviewing(true);
    try {
      const found = await findPreview({ path: source.path, password: source.password ?? undefined, find: findText, caseSensitive: findCaseSensitive, wholeWord: findWholeWord, regex: findRegex, pages: pages.trim() || undefined, limit: FIND_PREVIEW_LIMIT });
      if (request === findRequest.current) setFindHits(found);
    } catch (error) {
      if (request !== findRequest.current) return;
      setFindHits(null);
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      if (request === findRequest.current) setFindPreviewing(false);
    }
  };

  return {
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    findCaseSensitive,
    setFindCaseSensitive,
    findWholeWord,
    setFindWholeWord,
    findRegex,
    setFindRegex,
    findHits,
    findPreviewing,
    previewFind,
  };
}

export type FindReplaceState = ReturnType<typeof useFindReplaceState>;
