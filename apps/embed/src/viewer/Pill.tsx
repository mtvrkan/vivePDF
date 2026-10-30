import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useRotate } from "@embedpdf/plugin-rotate/preact";
import { useScroll } from "@embedpdf/plugin-scroll/preact";
import { SpreadMode, useSpread } from "@embedpdf/plugin-spread/preact";
import { ZoomMode, useZoom } from "@embedpdf/plugin-zoom/preact";
import { Icon } from "./Icon";
import { useT } from "./i18nContext";
import { MoreMenu } from "./MoreMenu";
import { formatZoom, parsePageInput } from "./pageInput";
import { usePillVisibility } from "./usePillVisibility";

function PageBox({ documentId }: { documentId: string }) {
  const t = useT();
  const { state, provides: scroll } = useScroll(documentId);
  const [draft, setDraft] = useState(String(state.currentPage));

  useEffect(() => setDraft(String(state.currentPage)), [state.currentPage]);

  const commit = () => {
    const page = parsePageInput(draft, state.totalPages);
    if (page === null) setDraft(String(state.currentPage));
    else if (page !== state.currentPage) scroll?.scrollToPage({ pageNumber: page, behavior: "instant" });
  };

  return (
    <span class="vp-pagebox">
      <span class="vp-wide">
        <button class="vp-btn" type="button" aria-label={t("previousPage")} disabled={state.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage()}>
          <Icon name="up" />
        </button>
      </span>
      <input
        class="vp-field"
        value={draft}
        inputMode="numeric"
        enterKeyHint="go"
        aria-label={t("pageNumber")}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.select();
          } else if (event.key === "Escape") {
            setDraft(String(state.currentPage));
            event.currentTarget.blur();
          }
        }}
      />
      <span>{t("pageOf", { total: state.totalPages })}</span>
      <span class="vp-wide">
        <button class="vp-btn" type="button" aria-label={t("nextPage")} disabled={state.currentPage >= state.totalPages} onClick={() => scroll?.scrollToNextPage()}>
          <Icon name="down" />
        </button>
      </span>
    </span>
  );
}

type PillProps = { documentId: string; host: HTMLElement | null; panelOpen: boolean; onTogglePanel: () => void; panelButtonRef: RefObject<HTMLButtonElement> };

export function Pill({ documentId, host, panelOpen, onTogglePanel, panelButtonRef }: PillProps) {
  const t = useT();
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const { provides: rotate } = useRotate(documentId);
  const { spreadMode, provides: spread } = useSpread(documentId);
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const hidden = usePillVisibility(host, pillRef, menuOpen);
  const fitsWidth = zoomState.zoomLevel === ZoomMode.FitWidth;
  const fit = () => zoom?.requestZoom(fitsWidth ? ZoomMode.FitPage : ZoomMode.FitWidth);
  const fitLabel = fitsWidth ? t("fitPage") : t("fitWidth");

  return (
    <div ref={pillRef} class="vp-pill vp-glass" role="toolbar" aria-label={t("toolbar")} data-hidden={hidden ? "true" : "false"}>
      <button ref={panelButtonRef} class="vp-btn" type="button" aria-label={t("panel")} title={t("panel")} aria-pressed={panelOpen} onClick={onTogglePanel}>
        <Icon name="panel" />
      </button>
      <span class="vp-sep" />
      <PageBox documentId={documentId} />
      <span class="vp-sep" />
      <button class="vp-btn" type="button" aria-label={t("zoomOut")} onClick={() => zoom?.zoomOut()}>
        <Icon name="minus" />
      </button>
      <span class="vp-zoom-value" role="status" aria-label={t("zoomLevel", { value: formatZoom(zoomState.currentZoomLevel) })}>
        {formatZoom(zoomState.currentZoomLevel)}
      </span>
      <button class="vp-btn" type="button" aria-label={t("zoomIn")} onClick={() => zoom?.zoomIn()}>
        <Icon name="plus" />
      </button>
      <span class="vp-wide">
        <button class="vp-btn" type="button" aria-label={fitLabel} title={fitLabel} onClick={fit}>
          <Icon name={fitsWidth ? "fitPage" : "fitWidth"} />
        </button>
        <button class="vp-btn" type="button" aria-label={t("rotate")} title={t("rotate")} onClick={() => rotate?.rotateForward()}>
          <Icon name="rotate" />
        </button>
      </span>
      <span class="vp-sep" />
      <MoreMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={[
          { kind: "action", id: "fit", label: fitLabel, icon: fitsWidth ? "fitPage" : "fitWidth", narrowOnly: true, onSelect: fit },
          { kind: "action", id: "rotate", label: t("rotate"), icon: "rotate", narrowOnly: true, onSelect: () => rotate?.rotateForward() },
          { kind: "separator", id: "layout-sep", narrowOnly: true },
          { kind: "radio", id: "single", label: t("singlePage"), icon: "single", checked: spreadMode === SpreadMode.None, onSelect: () => spread?.setSpreadMode(SpreadMode.None) },
          { kind: "radio", id: "double", label: t("twoPages"), icon: "double", checked: spreadMode !== SpreadMode.None, onSelect: () => spread?.setSpreadMode(SpreadMode.Odd) },
        ]}
      />
    </div>
  );
}
