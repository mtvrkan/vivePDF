import { useEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon";
import { useT } from "./i18nContext";
import { Outline } from "./Outline";
import { Thumbnails } from "./Thumbnails";

export type PanelTab = "pages" | "outline";

type SidePanelProps = {
  documentId: string;
  sourceUrl: string;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
  onPick: () => void;
};

const TABS: PanelTab[] = ["pages", "outline"];

export function SidePanel({ documentId, sourceUrl, tab, onTabChange, onClose, onPick }: SidePanelProps) {
  const t = useT();
  const panelRef = useRef<HTMLElement>(null);
  const tabLabel = (value: PanelTab) => (value === "pages" ? t("pagesTab") : t("outlineTab"));

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, []);

  return (
    <aside
      ref={panelRef}
      class="vp-panel"
      aria-label={t("panel")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div class="vp-panel-head">
        <div class="vp-seg" role="tablist" aria-label={t("panel")}>
          {TABS.map((value) => (
            <button
              key={value}
              id={`vp-tab-${value}`}
              type="button"
              role="tab"
              class="vp-seg-tab"
              aria-selected={tab === value}
              aria-controls="vp-panel-body"
              tabIndex={tab === value ? 0 : -1}
              onClick={() => onTabChange(value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = TABS[(TABS.indexOf(value) + 1) % TABS.length];
                onTabChange(next);
                panelRef.current?.querySelector<HTMLElement>(`#vp-tab-${next}`)?.focus();
              }}
            >
              {tabLabel(value)}
            </button>
          ))}
        </div>
        <button type="button" class="vp-btn" aria-label={t("closePanel")} title={t("closePanel")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div id="vp-panel-body" class="vp-panel-body" role="tabpanel" aria-labelledby={`vp-tab-${tab}`}>
        {tab === "pages" ? <Thumbnails documentId={documentId} onPick={onPick} /> : <Outline documentId={documentId} sourceUrl={sourceUrl} onPick={onPick} />}
      </div>
    </aside>
  );
}
