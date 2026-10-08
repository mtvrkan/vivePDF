import { useState } from "react";
import { useCvStore } from "./cvStore";
import { sectionVisible, type CvProfile, type CvSectionKey } from "./cvModel";
import { CertificatesSection, CustomSection, EducationSection, ExperienceSection, ProjectsSection, ReferencesSection } from "./fields/EntrySections";
import { InterestsSection, LeveledSection, SummarySection } from "./fields/ListSections";
import { PersonalSection } from "./fields/PersonalSection";

function initiallyOpen(profile: CvProfile): Set<CvSectionKey> {
  const filled = profile.order.filter((key) => sectionVisible({ ...profile, hidden: [] }, key));
  const next = profile.order.find((key) => !filled.includes(key));
  return new Set(next ? [...filled, next] : filled);
}

function SectionFor({ section, open }: { section: CvSectionKey; open: boolean }) {
  if (section === "summary") return <SummarySection defaultOpen={open} />;
  if (section === "experience") return <ExperienceSection defaultOpen={open} />;
  if (section === "education") return <EducationSection defaultOpen={open} />;
  if (section === "skills" || section === "languages") return <LeveledSection listKey={section} defaultOpen={open} />;
  if (section === "certificates") return <CertificatesSection defaultOpen={open} />;
  if (section === "projects") return <ProjectsSection defaultOpen={open} />;
  if (section === "references") return <ReferencesSection defaultOpen={open} />;
  if (section === "interests") return <InterestsSection defaultOpen={open} />;
  return <CustomSection defaultOpen={open} />;
}

export function CvForm() {
  const order = useCvStore((state) => state.profile.order);
  const [open] = useState(() => initiallyOpen(useCvStore.getState().profile));
  return (
    <div className="space-y-3">
      <PersonalSection />
      {order.map((section) => (
        <SectionFor key={section} section={section} open={open.has(section)} />
      ))}
    </div>
  );
}
