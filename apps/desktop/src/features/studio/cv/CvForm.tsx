import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, SelectInput, TextArea, TextInput } from "@/components/tool/form";
import { basenameOf } from "@/shared/lib/paths";
import { cn } from "@/shared/lib/cn";
import { useImagePreview } from "../design/assets";
import { pickImage } from "../design/pickImage";
import {
  CV_CONTACT_KINDS,
  CV_LIMITS,
  CV_TEXT_LIMIT,
  MAX_LEVEL,
  emptyCertificate,
  emptyContact,
  emptyCustom,
  emptyEducation,
  emptyExperience,
  emptyLeveled,
  emptyProject,
  emptyReference,
  type CvContactKind,
  type CvProfile,
  type CvSectionKey,
} from "./cvModel";
import { useCvStore } from "./cvStore";

type Identified = { id: string };
type ListKey = "contacts" | "experience" | "education" | "skills" | "languages" | "certificates" | "projects" | "references" | "custom";

function useProfileField() {
  const update = useCvStore((state) => state.updateProfile);
  return {
    set: <K extends keyof CvProfile>(key: K, value: CvProfile[K]) => update((profile) => ({ ...profile, [key]: value })),
    patchItem: <K extends ListKey>(key: K, id: string, patch: Partial<CvProfile[K][number]>) =>
      update((profile) => ({ ...profile, [key]: (profile[key] as Identified[]).map((item) => (item.id === id ? { ...item, ...patch } : item)) })),
    add: <K extends ListKey>(key: K, item: CvProfile[K][number]) => update((profile) => ({ ...profile, [key]: [...(profile[key] as Identified[]), item] })),
    remove: (key: ListKey, id: string) => update((profile) => ({ ...profile, [key]: (profile[key] as Identified[]).filter((item) => item.id !== id) })),
    move: (key: ListKey, id: string, step: -1 | 1) =>
      update((profile) => {
        const items = [...(profile[key] as Identified[])];
        const index = items.findIndex((item) => item.id === id);
        const target = index + step;
        if (index < 0 || target < 0 || target >= items.length) return profile;
        [items[index], items[target]] = [items[target], items[index]];
        return { ...profile, [key]: items };
      }),
  };
}

function FormSection({ title, section, count, children, defaultOpen = false }: { title: string; section?: CvSectionKey; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const hidden = useCvStore((state) => (section ? state.profile.hidden.includes(section) : false));
  const update = useCvStore((state) => state.updateProfile);
  const toggleHidden = () => {
    if (!section) return;
    update((profile) => ({ ...profile, hidden: hidden ? profile.hidden.filter((key) => key !== section) : [...profile.hidden, section] }));
  };
  return (
    <section className="card glass-tinted rounded-xl" data-cv-section={section ?? "personal"}>
      <div className="flex items-center gap-1 pe-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3.5 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)", !open && "-rotate-90 rtl:rotate-90")} aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", hidden && "text-muted-foreground line-through")}>{title}</span>
          {count !== undefined ? <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span> : null}
        </button>
        {section ? <IconButton icon={hidden ? EyeOff : Eye} label={hidden ? t("studio.cv.showSection", { name: title }) : t("studio.cv.hideSection", { name: title })} onClick={toggleHidden} /> : null}
      </div>
      {open ? <div className="space-y-3 border-t border-border/60 px-3.5 pb-3.5 pt-3">{children}</div> : null}
    </section>
  );
}

function ItemCard({ label, index, total, onMove, onRemove, children }: { label: string; index: number; total: number; onMove: (step: -1 | 1) => void; onRemove: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2.5 rounded-lg border border-border/70 p-3">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{label}</span>
        <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name: label })} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name: label })} disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton icon={Trash2} label={t("studio.cv.remove", { name: label })} onClick={onRemove} />
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={disabled} onClick={onClick} className="w-full justify-center border border-dashed border-border">
      {label}
    </Button>
  );
}

function Input({ label, value, onChange, max = 200, placeholder }: { label: string; value: string; onChange: (value: string) => void; max?: number; placeholder?: string }) {
  return (
    <Field label={label}>
      <TextInput value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function Paragraph({ label, value, onChange, hint, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; hint?: string; rows?: number }) {
  return (
    <Field label={label} hint={hint}>
      <TextArea value={value} rows={rows} maxLength={CV_TEXT_LIMIT} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function LevelPicker({ label, value, onChange, labels }: { label: string; value: number; onChange: (value: number) => void; labels: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {Array.from({ length: MAX_LEVEL }, (_, index) => {
        const level = index + 1;
        const active = level <= value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            title={labels[index]}
            aria-label={labels[index]}
            onClick={() => onChange(value === level ? 0 : level)}
            className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("size-3.5 rounded-full border", active ? "border-primary bg-primary" : "border-border bg-transparent")} />
          </button>
        );
      })}
      <span className="ms-1 min-w-0 truncate text-xs text-muted-foreground">{value > 0 ? labels[value - 1] : t("studio.cv.noLevel")}</span>
    </div>
  );
}

function PhotoField() {
  const { t } = useTranslation();
  const photo = useCvStore((state) => state.profile.photo);
  const { set } = useProfileField();
  const preview = useImagePreview(photo);
  const ready = preview?.status === "ready" ? preview.value : null;
  const choose = async () => {
    const path = await pickImage(t("studio.cv.photo"));
    if (path) set("photo", path);
  };
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
        {ready ? <img src={ready.url} alt="" width={64} height={64} className="size-full object-cover" /> : <ImagePlus className="size-5 text-muted-foreground" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-medium">{photo ? basenameOf(photo) : t("studio.cv.noPhoto")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void choose()}>
            {photo ? t("studio.cv.changePhoto") : t("studio.cv.addPhoto")}
          </Button>
          {photo ? (
            <Button size="sm" variant="ghost" onClick={() => set("photo", null)}>
              {t("studio.cv.removePhoto")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CvForm() {
  const { t } = useTranslation();
  const profile = useCvStore((state) => state.profile);
  const field = useProfileField();
  const levels = Array.from({ length: MAX_LEVEL }, (_, index) => t(`studio.cv.levels.${index + 1}`));
  const section = (key: CvSectionKey) => t(`studio.cv.sections.${key}`);
  const describe = (value: string, fallback: string, index: number) => value.trim() || `${fallback} ${index + 1}`;

  return (
    <div className="space-y-3">
      <FormSection title={t("studio.cv.personal")} defaultOpen>
        <PhotoField />
        <Input label={t("studio.cv.fields.name")} value={profile.name} onChange={(value) => field.set("name", value)} />
        <Input label={t("studio.cv.fields.headline")} value={profile.headline} onChange={(value) => field.set("headline", value)} placeholder={t("studio.cv.sample.headline")} />
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground/80">{t("studio.cv.sections.contact")}</p>
          {profile.contacts.map((contact) => (
            <div key={contact.id} className="flex items-center gap-2">
              <SelectInput aria-label={t("studio.cv.contactKind")} value={contact.kind} onChange={(event) => field.patchItem("contacts", contact.id, { kind: event.target.value as CvContactKind })} className="w-32 shrink-0">
                {CV_CONTACT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`studio.cv.contactKinds.${kind}`)}
                  </option>
                ))}
              </SelectInput>
              <TextInput aria-label={t(`studio.cv.contactKinds.${contact.kind}`)} value={contact.value} maxLength={300} onChange={(event) => field.patchItem("contacts", contact.id, { value: event.target.value })} />
              <IconButton icon={Trash2} label={t("studio.cv.remove", { name: t(`studio.cv.contactKinds.${contact.kind}`) })} onClick={() => field.remove("contacts", contact.id)} />
            </div>
          ))}
          <AddButton label={t("studio.cv.addContact")} disabled={profile.contacts.length >= CV_LIMITS.contacts} onClick={() => field.add("contacts", emptyContact("website"))} />
        </div>
      </FormSection>

      <FormSection title={section("summary")} section="summary" defaultOpen>
        <Paragraph label={section("summary")} value={profile.summary} onChange={(value) => field.set("summary", value)} hint={t("studio.cv.hints.summary")} rows={5} />
      </FormSection>

      <FormSection title={section("experience")} section="experience" count={profile.experience.length}>
        {profile.experience.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.role, section("experience"), index)} index={index} total={profile.experience.length} onMove={(step) => field.move("experience", item.id, step)} onRemove={() => field.remove("experience", item.id)}>
            <Input label={t("studio.cv.fields.role")} value={item.role} onChange={(value) => field.patchItem("experience", item.id, { role: value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input label={t("studio.cv.fields.organisation")} value={item.organisation} onChange={(value) => field.patchItem("experience", item.id, { organisation: value })} />
              <Input label={t("studio.cv.fields.location")} value={item.location} onChange={(value) => field.patchItem("experience", item.id, { location: value })} />
              <Input label={t("studio.cv.fields.start")} value={item.start} max={40} onChange={(value) => field.patchItem("experience", item.id, { start: value })} placeholder="2021" />
              {item.current ? (
                <Field label={t("studio.cv.fields.end")}>
                  <TextInput value={t("studio.cv.present")} disabled readOnly />
                </Field>
              ) : <Input label={t("studio.cv.fields.end")} value={item.end} max={40} onChange={(value) => field.patchItem("experience", item.id, { end: value })} placeholder="2024" />}
            </div>
            <Checkbox label={t("studio.cv.fields.current")} checked={item.current} onChange={(current) => field.patchItem("experience", item.id, { current })} />
            <Paragraph label={t("studio.cv.fields.details")} value={item.details} onChange={(value) => field.patchItem("experience", item.id, { details: value })} hint={t("studio.cv.hints.bullets")} />
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.experience")} disabled={profile.experience.length >= CV_LIMITS.experience} onClick={() => field.add("experience", emptyExperience())} />
      </FormSection>

      <FormSection title={section("education")} section="education" count={profile.education.length}>
        {profile.education.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.degree, section("education"), index)} index={index} total={profile.education.length} onMove={(step) => field.move("education", item.id, step)} onRemove={() => field.remove("education", item.id)}>
            <Input label={t("studio.cv.fields.degree")} value={item.degree} onChange={(value) => field.patchItem("education", item.id, { degree: value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input label={t("studio.cv.fields.school")} value={item.school} onChange={(value) => field.patchItem("education", item.id, { school: value })} />
              <Input label={t("studio.cv.fields.location")} value={item.location} onChange={(value) => field.patchItem("education", item.id, { location: value })} />
              <Input label={t("studio.cv.fields.start")} value={item.start} max={40} onChange={(value) => field.patchItem("education", item.id, { start: value })} />
              <Input label={t("studio.cv.fields.end")} value={item.end} max={40} onChange={(value) => field.patchItem("education", item.id, { end: value })} />
            </div>
            <Paragraph label={t("studio.cv.fields.details")} value={item.details} onChange={(value) => field.patchItem("education", item.id, { details: value })} rows={2} />
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.education")} disabled={profile.education.length >= CV_LIMITS.education} onClick={() => field.add("education", emptyEducation())} />
      </FormSection>

      {(["skills", "languages"] as const).map((key) => (
        <FormSection key={key} title={section(key)} section={key} count={profile[key].length}>
          {profile[key].map((item, index) => (
            <div key={item.id} className="space-y-1.5 rounded-lg border border-border/70 p-2.5">
              <div className="flex items-center gap-1">
                <TextInput aria-label={t(`studio.cv.fields.${key === "skills" ? "skill" : "language"}`)} value={item.name} maxLength={120} placeholder={t(`studio.cv.fields.${key === "skills" ? "skill" : "language"}`)} onChange={(event) => field.patchItem(key, item.id, { name: event.target.value })} />
                <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name: describe(item.name, section(key), index) })} disabled={index === 0} onClick={() => field.move(key, item.id, -1)} />
                <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name: describe(item.name, section(key), index) })} disabled={index === profile[key].length - 1} onClick={() => field.move(key, item.id, 1)} />
                <IconButton icon={Trash2} label={t("studio.cv.remove", { name: describe(item.name, section(key), index) })} onClick={() => field.remove(key, item.id)} />
              </div>
              <LevelPicker label={t("studio.cv.level", { name: describe(item.name, section(key), index) })} value={item.level} onChange={(level) => field.patchItem(key, item.id, { level })} labels={key === "languages" ? Array.from({ length: MAX_LEVEL }, (_, levelIndex) => t(`studio.cv.languageLevels.${levelIndex + 1}`)) : levels} />
            </div>
          ))}
          <AddButton label={t(`studio.cv.add.${key}`)} disabled={profile[key].length >= CV_LIMITS[key]} onClick={() => field.add(key, emptyLeveled(key === "languages" ? 3 : 4))} />
        </FormSection>
      ))}

      <FormSection title={section("certificates")} section="certificates" count={profile.certificates.length}>
        {profile.certificates.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.name, section("certificates"), index)} index={index} total={profile.certificates.length} onMove={(step) => field.move("certificates", item.id, step)} onRemove={() => field.remove("certificates", item.id)}>
            <Input label={t("studio.cv.fields.certificate")} value={item.name} onChange={(value) => field.patchItem("certificates", item.id, { name: value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input label={t("studio.cv.fields.issuer")} value={item.issuer} onChange={(value) => field.patchItem("certificates", item.id, { issuer: value })} />
              <Input label={t("studio.cv.fields.date")} value={item.date} max={40} onChange={(value) => field.patchItem("certificates", item.id, { date: value })} />
            </div>
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.certificates")} disabled={profile.certificates.length >= CV_LIMITS.certificates} onClick={() => field.add("certificates", emptyCertificate())} />
      </FormSection>

      <FormSection title={section("projects")} section="projects" count={profile.projects.length}>
        {profile.projects.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.name, section("projects"), index)} index={index} total={profile.projects.length} onMove={(step) => field.move("projects", item.id, step)} onRemove={() => field.remove("projects", item.id)}>
            <Input label={t("studio.cv.fields.project")} value={item.name} onChange={(value) => field.patchItem("projects", item.id, { name: value })} />
            <Input label={t("studio.cv.fields.link")} value={item.link} max={300} onChange={(value) => field.patchItem("projects", item.id, { link: value })} />
            <Paragraph label={t("studio.cv.fields.details")} value={item.details} onChange={(value) => field.patchItem("projects", item.id, { details: value })} rows={3} hint={t("studio.cv.hints.bullets")} />
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.projects")} disabled={profile.projects.length >= CV_LIMITS.projects} onClick={() => field.add("projects", emptyProject())} />
      </FormSection>

      <FormSection title={section("references")} section="references" count={profile.references.length}>
        {profile.references.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.name, section("references"), index)} index={index} total={profile.references.length} onMove={(step) => field.move("references", item.id, step)} onRemove={() => field.remove("references", item.id)}>
            <Input label={t("studio.cv.fields.referenceName")} value={item.name} onChange={(value) => field.patchItem("references", item.id, { name: value })} />
            <Input label={t("studio.cv.fields.referenceRole")} value={item.role} onChange={(value) => field.patchItem("references", item.id, { role: value })} />
            <Input label={t("studio.cv.fields.referenceContact")} value={item.contact} max={300} onChange={(value) => field.patchItem("references", item.id, { contact: value })} />
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.references")} disabled={profile.references.length >= CV_LIMITS.references} onClick={() => field.add("references", emptyReference())} />
      </FormSection>

      <FormSection title={section("interests")} section="interests">
        <Paragraph label={section("interests")} value={profile.interests} onChange={(value) => field.set("interests", value)} hint={t("studio.cv.hints.interests")} rows={2} />
      </FormSection>

      <FormSection title={section("custom")} section="custom" count={profile.custom.length}>
        {profile.custom.map((item, index) => (
          <ItemCard key={item.id} label={describe(item.heading, section("custom"), index)} index={index} total={profile.custom.length} onMove={(step) => field.move("custom", item.id, step)} onRemove={() => field.remove("custom", item.id)}>
            <Input label={t("studio.cv.fields.heading")} value={item.heading} max={120} onChange={(value) => field.patchItem("custom", item.id, { heading: value })} />
            <Paragraph label={t("studio.cv.fields.body")} value={item.body} onChange={(value) => field.patchItem("custom", item.id, { body: value })} hint={t("studio.cv.hints.bullets")} />
          </ItemCard>
        ))}
        <AddButton label={t("studio.cv.add.custom")} disabled={profile.custom.length >= CV_LIMITS.custom} onClick={() => field.add("custom", emptyCustom())} />
      </FormSection>
    </div>
  );
}
