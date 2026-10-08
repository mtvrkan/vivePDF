import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { addItems, canAdd, moveItem, patchItem, setProfileField } from "../cvEdits";
import { emptyLeveled, MAX_LEVEL, splitListText, type CvLeveled } from "../cvModel";
import { useCvStore } from "../cvStore";
import { useRemoveWithUndo } from "./useRemoveWithUndo";
import { FormSection } from "./FormSection";
import { useClaimedFocus } from "./fieldChecks";
import { LevelPicker, ParagraphField } from "./inputs";
import { usePointerReorder } from "./usePointerReorder";

type LeveledKey = "skills" | "languages";

const DEFAULT_LEVEL: Record<LeveledKey, number> = { skills: 4, languages: 3 };

function focusNextRow(input: HTMLInputElement): boolean {
  const list = input.closest("[data-reorder-list]");
  const row = input.closest("[data-reorder-index]");
  const next = row?.nextElementSibling;
  const target = next?.querySelector<HTMLInputElement>("input[type='text'], input:not([type])");
  if (!list || !target) return false;
  target.focus();
  return true;
}

function LeveledRow({ listKey, item, index, total, levels, dragging, target, onGrip }: { listKey: LeveledKey; item: CvLeveled; index: number; total: number; levels: string[]; dragging: boolean; target: boolean; onGrip: ReturnType<ReturnType<typeof usePointerReorder>["begin"]> }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useClaimedFocus(item.id, inputRef);
  const remove = useRemoveWithUndo(listKey);
  const field = t(`studio.cv.fields.${listKey === "skills" ? "skill" : "language"}`);
  const name = item.name.trim() || `${t(`studio.cv.sections.${listKey}`)} ${index + 1}`;

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pieces = splitListText(event.clipboardData.getData("text/plain"));
    if (pieces.length < 2) return;
    event.preventDefault();
    const empty = !item.name.trim();
    const [first, ...rest] = pieces;
    if (empty) patchItem(listKey, item.id, { name: first.slice(0, 120) }, false);
    addItems(
      listKey,
      (empty ? rest : pieces).map((piece) => ({ ...emptyLeveled(DEFAULT_LEVEL[listKey]), name: piece.slice(0, 120) })),
      item.id,
      false,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (focusNextRow(event.currentTarget)) return;
    if (item.name.trim()) addItems(listKey, [emptyLeveled(DEFAULT_LEVEL[listKey])], item.id);
  };

  return (
    <div data-reorder-index={index} data-cv-entry={item.id} className={cn("space-y-1.5 rounded-lg border border-border/70 p-2.5", dragging && "opacity-60 ring-2 ring-primary", target && "border-primary")}>
      <div className="flex items-center gap-0.5">
        <span aria-hidden onPointerDown={onGrip} title={t("studio.cv.drag", { name })} className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground" data-reorder-grip>
          <GripVertical className="size-4" />
        </span>
        <TextInput ref={inputRef} aria-label={field} value={item.name} maxLength={120} placeholder={t(`studio.cv.placeholders.${listKey === "skills" ? "skill" : "language"}`)} onPaste={onPaste} onKeyDown={onKeyDown} onChange={(event) => patchItem(listKey, item.id, { name: event.target.value })} />
        <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name })} disabled={index === 0} onClick={() => moveItem(listKey, index, index - 1)} />
        <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name })} disabled={index === total - 1} onClick={() => moveItem(listKey, index, index + 1)} />
        <IconButton icon={Trash2} label={t("studio.cv.remove", { name })} onClick={() => remove(item.id, name)} />
      </div>
      <LevelPicker label={t("studio.cv.level", { name })} value={item.level} onChange={(level) => patchItem(listKey, item.id, { level }, false)} labels={levels} />
    </div>
  );
}

export function LeveledSection({ listKey, defaultOpen }: { listKey: LeveledKey; defaultOpen: boolean }) {
  const { t } = useTranslation();
  const items = useCvStore((state) => state.profile[listKey]);
  const room = useCvStore((state) => canAdd(state.profile, listKey));
  const { drag, begin } = usePointerReorder((from, to) => moveItem(listKey, from, to));
  const levels = Array.from({ length: MAX_LEVEL }, (_, index) => t(listKey === "languages" ? `studio.cv.languageLevels.${index + 1}` : `studio.cv.levels.${index + 1}`));
  return (
    <FormSection
      title={t(`studio.cv.sections.${listKey}`)}
      section={listKey}
      count={items.length}
      defaultOpen={defaultOpen}
      addLabel={t(`studio.cv.add.${listKey}`)}
      addDisabled={!room}
      onAdd={() => addItems(listKey, [emptyLeveled(DEFAULT_LEVEL[listKey])])}
    >
      {items.length ? (
        <div data-reorder-list className="space-y-2">
          {items.map((item, index) => (
            <LeveledRow key={item.id} listKey={listKey} item={item} index={index} total={items.length} levels={levels} dragging={drag?.from === index} target={drag !== null && drag.from !== index && drag.to === index} onGrip={begin(index)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("studio.cv.emptySection")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("studio.cv.hints.pasteList")}</p>
    </FormSection>
  );
}

export function SummarySection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  const summary = useCvStore((state) => state.profile.summary);
  const title = t("studio.cv.sections.summary");
  return (
    <FormSection title={title} section="summary" defaultOpen={defaultOpen}>
      <ParagraphField label={title} value={summary} placeholder={t("studio.cv.placeholders.summary")} onChange={(value) => setProfileField("summary", value)} hint={t("studio.cv.hints.summary")} rows={5} />
    </FormSection>
  );
}

export function InterestsSection({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  const interests = useCvStore((state) => state.profile.interests);
  const title = t("studio.cv.sections.interests");
  return (
    <FormSection title={title} section="interests" defaultOpen={defaultOpen}>
      <ParagraphField label={title} value={interests} placeholder={t("studio.cv.placeholders.interests")} onChange={(value) => setProfileField("interests", value)} hint={t("studio.cv.hints.interests")} rows={2} />
    </FormSection>
  );
}
