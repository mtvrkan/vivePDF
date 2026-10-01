import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { getTextSpans } from "@/shared/rpc/operations";
import type { SourceDocument, TextEdit, TextSpan, ToastKind } from "@/types";
import type { Tab } from "./editShared";
import { sameAsSpan } from "./textEditState";

export function useTextEditState(source: SourceDocument | null, tab: Tab, t: TFunction, toast: (kind: ToastKind, message: string) => void) {
  const [teditPage, setTeditPage] = useState(1);
  const [teditSpans, setTeditSpans] = useState<TextSpan[]>([]);
  const [teditSize, setTeditSize] = useState<{ width: number; height: number } | null>(null);
  const [teditLoading, setTeditLoading] = useState(false);
  const [teditEdits, setTeditEdits] = useState<Map<string, TextEdit>>(new Map());
  const [teditActiveId, setTeditActiveId] = useState<string | null>(null);
  const [pendingTeditPage, setPendingTeditPage] = useState<number | null>(null);
  const spansRequest = useRef(0);

  const loadSpans = useCallback(async () => {
    if (!source?.info) return;
    const request = ++spansRequest.current;
    setTeditLoading(true);
    try {
      const result = await getTextSpans({ path: source.path, password: source.password ?? undefined, page: teditPage - 1, visible: true });
      if (request !== spansRequest.current) return;
      setTeditSpans(result.spans);
      setTeditSize({ width: result.width, height: result.height });
    } catch (error) {
      if (request !== spansRequest.current) return;
      const rpcError = toRpcError(error);
      toast("error", describeError(t, rpcError));
    } finally {
      if (request === spansRequest.current) setTeditLoading(false);
    }
  }, [source, teditPage, t, toast]);

  useEffect(() => {
    if (tab === "textedit" && source?.info) void loadSpans();
  }, [tab, source?.path, source?.info, teditPage, loadSpans]);

  const goToTeditPage = (value: number) => {
    setPendingTeditPage(null);
    setTeditPage(value);
    setTeditEdits(new Map());
    setTeditActiveId(null);
  };

  const changeTeditPage = (value: number) => {
    if (value === teditPage) return;
    if (teditEdits.size > 0) setPendingTeditPage(value);
    else goToTeditPage(value);
  };

  const applySpanEdit = (span: TextSpan, patch: Partial<TextEdit>) => {
    setTeditEdits((state) => {
      const next = new Map(state);
      const existing = next.get(span.id);
      const merged: TextEdit = {
        bbox: span.bbox,
        text: existing?.text ?? span.text,
        size: existing?.size ?? span.size,
        color: existing?.color ?? span.color,
        bold: existing?.bold ?? span.bold,
        italic: existing?.italic ?? span.italic,
        font: existing?.font ?? span.font,
        fontXref: existing?.fontXref ?? span.fontXref,
        opacity: existing?.opacity ?? span.opacity ?? 1,
        ...patch,
      };
      if (sameAsSpan(merged, span)) next.delete(span.id);
      else next.set(span.id, merged);
      return next;
    });
  };

  const removeSpanEdit = (id: string) =>
    setTeditEdits((state) => {
      const next = new Map(state);
      next.delete(id);
      return next;
    });

  return {
    teditPage,
    teditSpans,
    teditSize,
    teditLoading,
    teditEdits,
    teditActiveId,
    setTeditActiveId,
    pendingTeditPage,
    setPendingTeditPage,
    goToTeditPage,
    changeTeditPage,
    applySpanEdit,
    removeSpanEdit,
  };
}
