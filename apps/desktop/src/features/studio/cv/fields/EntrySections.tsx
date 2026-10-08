import { useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, Field, TextInput } from "@/components/tool/form";
import { addItems, canAdd, moveItem, patchItem, type ListKey } from "../cvEdits";
import { emptyCertificate, emptyCustom, emptyEducation, emptyExperience, emptyProject, emptyReference, type CvProfile } from "../cvModel";
import { useCvStore } from "../cvStore";
import { EntryCard } from "./EntryCard";
import { FormSection } from "./FormSection";
import { useClaimedFocus } from "./fieldChecks";
import { ParagraphField, TextField } from "./inputs";
import { MonthYearField } from "./MonthYearField";
import { usePointerReorder } from "./usePointerReorder";

type EntryKey = Exclude<ListKey, "contacts" | "skills" | "languages">;
type Item<K extends EntryKey> = CvProfile[K][number];

const FACTORIES: { [K in EntryKey]: () => Item<K> } = {
  experience: emptyExperience,
  education: emptyEducation,
  certificates: emptyCertificate,
  projects: emptyProject,
  references: emptyReference,
  custom: emptyCustom,
};

function joined(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" · ");
}

function period(start: string, end: string, current: boolean, present: string): string {
  const finish = current ? present : end.trim();
  return [start.trim(), finish].filter(Boolean).join(" – ");
}

type EntrySectionProps<K extends EntryKey> = {
  listKey: K;
  defaultOpen: boolean;
  titleOf: (item: Item<K>) => string;
  summaryOf: (item: Item<K>) => string;
  render: (item: Item<K>, focusRef: RefObject<HTMLInputElement | null>) => ReactNode;
};

function EntryBody<K extends EntryKey>({ item, render }: { item: Item<K>; render: EntrySectionProps<K>["render"] }) {
  const focusRef = useRef<HTMLInputElement>(null);
  useClaimedFocus(item.id, focusRef);
  return <>{render(item, focusRef)}</>;
}

function EntrySection<K extends EntryKey>({ listKey, defaultOpen, titleOf, summaryOf, render }: EntrySectionProps<K>) {
  const { t } = useTranslation();
  const items = useCvStore((state) => state.profile[listKey]) as Item<K>[];
  const room = useCvStore((state) => canAdd(state.profile, listKey));
  const { drag, begin } = usePointerReorder((from, to) => moveItem(listKey, from, to));
  const section = t(`studio.cv.sections.${listKey}`);
  const add = () => addItems(listKey, [FACTORIES[listKey]()] as Item<K>[]);
  return (
    <FormSection title={section} section={listKey} count={items.length} defaultOpen={defaultOpen} addLabel={t(`studio.cv.add.${listKey}`)} addDisabled={!room} onAdd={add}>
      {items.length ? (
        <div data-reorder-list className="space-y-2.5">
          {items.map((item, index) => {
            const title = titleOf(item).trim() || `${section} ${index + 1}`;
            return (
              <EntryCard
                key={item.id}
                listKey={listKey}
                id={item.id}
                index={index}
                total={items.length}
                title={title}
                summary={summaryOf(item)}
                defaultOpen={!titleOf(item).trim() || items.length <= 2}
                dragging={drag?.from === index}
                target={drag !== null && drag.from !== index && drag.to === index}
                onGrip={begin(index)}
              >
                <EntryBody item={item} render={render} />
              </EntryCard>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("studio.cv.emptySection")}</p>
      )}
    </FormSection>
  );
}

export function ExperienceSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  const present = t("studio.cv.present");
  return (
    <EntrySection
      listKey="experience"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.role}
      summaryOf={(item) => joined([item.organisation, period(item.start, item.end, item.current, present)])}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("experience", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.role")} value={item.role} placeholder={t("studio.cv.placeholders.role")} onChange={(role) => patch({ role })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t("studio.cv.fields.organisation")} value={item.organisation} placeholder={t("studio.cv.placeholders.organisation")} onChange={(organisation) => patch({ organisation })} />
              <TextField label={t("studio.cv.fields.location")} value={item.location} placeholder={t("studio.cv.placeholders.location")} onChange={(location) => patch({ location })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MonthYearField label={t("studio.cv.fields.start")} value={item.start} onChange={(start) => patch({ start })} />
              {item.current ? (
                <Field label={t("studio.cv.fields.end")}>
                  <TextInput value={present} disabled readOnly />
                </Field>
              ) : (
                <MonthYearField label={t("studio.cv.fields.end")} value={item.end} onChange={(end) => patch({ end })} />
              )}
            </div>
            <Checkbox label={t("studio.cv.fields.current")} checked={item.current} onChange={(current) => patchItem("experience", item.id, { current }, false)} />
            <ParagraphField label={t("studio.cv.fields.details")} value={item.details} placeholder={t("studio.cv.placeholders.details")} onChange={(details) => patch({ details })} hint={t("studio.cv.hints.bullets")} />
          </>
        );
      }}
    />
  );
}

export function EducationSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  const present = t("studio.cv.present");
  return (
    <EntrySection
      listKey="education"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.degree}
      summaryOf={(item) => joined([item.school, period(item.start, item.end, item.current, present)])}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("education", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.degree")} value={item.degree} placeholder={t("studio.cv.placeholders.degree")} onChange={(degree) => patch({ degree })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t("studio.cv.fields.school")} value={item.school} placeholder={t("studio.cv.placeholders.school")} onChange={(school) => patch({ school })} />
              <TextField label={t("studio.cv.fields.location")} value={item.location} placeholder={t("studio.cv.placeholders.location")} onChange={(location) => patch({ location })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MonthYearField label={t("studio.cv.fields.start")} value={item.start} onChange={(start) => patch({ start })} />
              {item.current ? (
                <Field label={t("studio.cv.fields.end")}>
                  <TextInput value={present} disabled readOnly />
                </Field>
              ) : (
                <MonthYearField label={t("studio.cv.fields.end")} value={item.end} onChange={(end) => patch({ end })} />
              )}
            </div>
            <Checkbox label={t("studio.cv.fields.studying")} checked={item.current} onChange={(current) => patchItem("education", item.id, { current }, false)} />
            <ParagraphField label={t("studio.cv.fields.details")} value={item.details} placeholder={t("studio.cv.placeholders.educationDetails")} onChange={(details) => patch({ details })} rows={2} />
          </>
        );
      }}
    />
  );
}

export function CertificatesSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <EntrySection
      listKey="certificates"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.name}
      summaryOf={(item) => joined([item.issuer, item.date])}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("certificates", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.certificate")} value={item.name} placeholder={t("studio.cv.placeholders.certificate")} onChange={(name) => patch({ name })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t("studio.cv.fields.issuer")} value={item.issuer} placeholder={t("studio.cv.placeholders.issuer")} onChange={(issuer) => patch({ issuer })} />
              <MonthYearField label={t("studio.cv.fields.date")} value={item.date} onChange={(date) => patch({ date })} />
            </div>
          </>
        );
      }}
    />
  );
}

export function ProjectsSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <EntrySection
      listKey="projects"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.name}
      summaryOf={(item) => item.link.trim()}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("projects", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.project")} value={item.name} placeholder={t("studio.cv.placeholders.project")} onChange={(name) => patch({ name })} />
            <TextField label={t("studio.cv.fields.link")} value={item.link} max={300} check="url" placeholder={t("studio.cv.placeholders.link")} onChange={(link) => patch({ link })} />
            <ParagraphField label={t("studio.cv.fields.details")} value={item.details} placeholder={t("studio.cv.placeholders.projectDetails")} onChange={(details) => patch({ details })} rows={3} hint={t("studio.cv.hints.bullets")} />
          </>
        );
      }}
    />
  );
}

export function ReferencesSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <EntrySection
      listKey="references"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.name}
      summaryOf={(item) => item.role.trim()}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("references", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.referenceName")} value={item.name} placeholder={t("studio.cv.placeholders.referenceName")} onChange={(name) => patch({ name })} />
            <TextField label={t("studio.cv.fields.referenceRole")} value={item.role} placeholder={t("studio.cv.placeholders.referenceRole")} onChange={(role) => patch({ role })} />
            <TextField label={t("studio.cv.fields.referenceContact")} value={item.contact} max={300} placeholder={t("studio.cv.placeholders.referenceContact")} onChange={(contact) => patch({ contact })} />
          </>
        );
      }}
    />
  );
}

export function CustomSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <EntrySection
      listKey="custom"
      defaultOpen={defaultOpen}
      titleOf={(item) => item.heading}
      summaryOf={() => ""}
      render={(item, focusRef) => {
        const patch = (change: Partial<typeof item>) => patchItem("custom", item.id, change);
        return (
          <>
            <TextField inputRef={focusRef} label={t("studio.cv.fields.heading")} value={item.heading} max={120} placeholder={t("studio.cv.placeholders.heading")} onChange={(heading) => patch({ heading })} />
            <ParagraphField label={t("studio.cv.fields.body")} value={item.body} placeholder={t("studio.cv.placeholders.body")} onChange={(body) => patch({ body })} hint={t("studio.cv.hints.bullets")} />
          </>
        );
      }}
    />
  );
}
