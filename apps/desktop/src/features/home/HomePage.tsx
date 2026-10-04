import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Check, LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { cn } from "@/shared/lib/cn";
import { CollectionsSection } from "./CollectionsSection";
import { ContinueStrip } from "./ContinueStrip";
import { HeroSection } from "./HeroSection";
import { HistoryRail } from "./HistoryRail";
import { DropLine, HomeEditBar, HomeSectionFrame } from "./HomeLayoutEditor";
import { dropIndex, moveSection, sectionsIn, type HomeRegion, type HomeSectionId, type HomeSectionLayout, type HomeSize, type SidebarWidth } from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";
import { QuickActions } from "./QuickActions";
import { RecentDocuments } from "./RecentDocuments";
import { StatsCard } from "./StatsCard";
import { ToolCatalogue } from "./ToolCatalogue";

const SIDEBAR_COLUMNS: Record<SidebarWidth, string> = { narrow: "16rem", normal: "20rem", wide: "26rem" };
const EDGE_SCROLL = 64;
const SCROLL_STEP = 18;

let mountedHomes = 0;

type Drag = { id: HomeSectionId; region: HomeRegion; index: number } | null;

function SectionContent({ id, size, editing }: { id: HomeSectionId; size: HomeSize; editing: boolean }) {
  if (id === "hero") return <HeroSection size={size} />;
  if (id === "quickActions") return <QuickActions size={size} editing={editing} />;
  if (id === "recent") return <RecentDocuments size={size} />;
  if (id === "collections") return <CollectionsSection size={size} />;
  if (id === "tools") return <ToolCatalogue size={size} />;
  if (id === "continue") return <ContinueStrip size={size} />;
  if (id === "history") return <HistoryRail size={size} />;
  return <StatsCard size={size} />;
}

export function HomePage() {
  const { t } = useTranslation();
  const layout = useHomeLayoutStore((state) => state.layout);
  const editing = useHomeLayoutStore((state) => state.editing);
  const setEditing = useHomeLayoutStore((state) => state.setEditing);
  const change = useHomeLayoutStore((state) => state.change);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  useEffect(() => {
    mountedHomes += 1;
    return () => {
      mountedHomes -= 1;
      window.setTimeout(() => {
        if (mountedHomes === 0) useHomeLayoutStore.getState().setEditing(false);
      }, 0);
    };
  }, []);

  const targetAt = (x: number, y: number): { region: HomeRegion; index: number } | null => {
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-home-drop]");
    const region = zone?.dataset.homeDrop as HomeRegion | undefined;
    if (!zone || !region) return null;
    const frames = Array.from(zone.querySelectorAll<HTMLElement>(":scope > [data-home-section]"));
    return { region, index: dropIndex(frames.map((frame) => frame.getBoundingClientRect().top + frame.getBoundingClientRect().height / 2), y) };
  };

  const startDrag = (section: HomeSectionLayout, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = sectionsIn(layout, section.region).findIndex((item) => item.id === section.id);
    setDrag({ id: section.id, region: section.region, index });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY < bounds.top + EDGE_SCROLL) scroller.scrollBy(0, -SCROLL_STEP);
      else if (event.clientY > bounds.bottom - EDGE_SCROLL) scroller.scrollBy(0, SCROLL_STEP);
    }
    const target = targetAt(event.clientX, event.clientY);
    if (target && (target.region !== drag.region || target.index !== drag.index)) setDrag({ ...drag, ...target });
  };

  const endDrag = () => {
    if (!drag) return;
    change((current) => moveSection(current, drag.id, drag.region, drag.index));
    setDrag(null);
  };

  const region = (name: HomeRegion, className?: string) => {
    const sections = sectionsIn(layout, name);
    if (!editing && sections.length === 0) return null;
    const from = drag ? sections.findIndex((section) => section.id === drag.id) : -1;
    const showLine = (index: number) => drag !== null && drag.region === name && drag.index === index && index !== from && index !== from + 1;
    return (
      <div data-home-drop={name} data-testid={`home-region-${name}`} className={cn("min-w-0 space-y-6", editing && "space-y-3 rounded-2xl", className)}>
        {editing ? <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(`home.layout.regions.${name}`)}</p> : null}
        {sections.map((section, index) => (
          <div key={section.id} data-home-section={section.id} className="space-y-3 empty:hidden">
            {showLine(index) ? <DropLine /> : null}
            {editing ? (
              <HomeSectionFrame
                section={section}
                dragging={drag?.id === section.id}
                interactive={section.id === "quickActions"}
                onDragStart={(event) => startDrag(section, event)}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
                onDragCancel={() => setDrag(null)}
              >
                <SectionContent id={section.id} size={section.size} editing />
              </HomeSectionFrame>
            ) : (
              <SectionContent id={section.id} size={section.size} editing={false} />
            )}
          </div>
        ))}
        {showLine(sections.length) ? <DropLine /> : null}
        {editing && sections.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-(--glass-border) px-4 py-8 text-center text-xs text-muted-foreground">{t("home.layout.dropHere")}</p>
        ) : null}
      </div>
    );
  };

  const hasSide = editing || sectionsIn(layout, "side").length > 0;
  const sideFirst = layout.sidebar.side === "start";
  const columns = hasSide ? (sideFirst ? `${SIDEBAR_COLUMNS[layout.sidebar.width]} minmax(0,1fr)` : `minmax(0,1fr) ${SIDEBAR_COLUMNS[layout.sidebar.width]}`) : undefined;

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div className="space-y-6 p-4 md:p-8">
        {editing ? <HomeEditBar /> : null}
        {region("top")}
        <div className="grid gap-6 md:grid-cols-(--home-columns)" style={columns ? ({ "--home-columns": columns } as CSSProperties) : undefined}>
          {sideFirst && hasSide ? region("side", "order-2 md:order-none") : null}
          {region("main")}
          {!sideFirst && hasSide ? region("side") : null}
        </div>
        {region("bottom")}
        {editing ? (
          <div className="pointer-events-none sticky bottom-0 flex justify-center">
            <Button variant="primary" icon={<Check className="size-4" aria-hidden />} onClick={() => setEditing(false)} className="pointer-events-auto rounded-full shadow-lg">
              {t("home.layout.done")}
            </Button>
          </div>
        ) : (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" icon={<LayoutDashboard className="size-4" aria-hidden />} onClick={() => setEditing(true)} className="glass rounded-full">
              {t("home.layout.edit")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
