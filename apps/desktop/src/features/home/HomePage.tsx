import { ContinueStrip } from "./ContinueStrip";
import { HeroSection } from "./HeroSection";
import { HistoryRail } from "./HistoryRail";
import { QuickActions } from "./QuickActions";
import { RecentDocuments } from "./RecentDocuments";
import { StatsCard } from "./StatsCard";
import { ToolCatalogue } from "./ToolCatalogue";

export function HomePage() {
  return (
    <div className="h-full overflow-auto">
      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_20rem] md:p-8">
        <div className="min-w-0 space-y-6">
          <HeroSection />
          <QuickActions />
          <RecentDocuments />
          <ToolCatalogue />
        </div>

        <aside className="space-y-4">
          <ContinueStrip />
          <HistoryRail />
          <StatsCard />
        </aside>
      </div>

    </div>
  );
}
