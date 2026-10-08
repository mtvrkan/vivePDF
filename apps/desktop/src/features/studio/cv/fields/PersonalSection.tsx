import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Crop, GripVertical, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { MenuButton } from "@/components/shared/MenuButton";
import { SelectInput, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { studioSaveImage } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useImagePreview } from "../../design/assets";
import { pickImage } from "../../design/pickImage";
import { addItems, canAdd, moveItem, patchItem, setProfileField } from "../cvEdits";
import { CV_CONTACT_KINDS, emptyContact, type CvContact, type CvContactKind } from "../cvModel";
import { useCvStore } from "../cvStore";
import { useRemoveWithUndo } from "./useRemoveWithUndo";
import { FormSection } from "./FormSection";
import { looksValid, useClaimedFocus, type ValueCheck } from "./fieldChecks";
import { TextField } from "./inputs";
import { PhotoCropDialog } from "./PhotoCropDialog";
import { usePointerReorder } from "./usePointerReorder";

const THUMB = 64;
const CONTACT_CHECKS: Partial<Record<CvContactKind, ValueCheck>> = { email: "email", phone: "phone", website: "url", linkedin: "url", github: "url" };

function PhotoField() {
  const { t } = useTranslation();
  const photo = useCvStore((state) => state.profile.photo);
  const photoCrop = useCvStore((state) => state.profile.photoCrop);
  const round = useCvStore((state) => state.theme.photoShape === "circle");
  const pushToast = useToastStore((state) => state.push);
  const preview = useImagePreview(photo);
  const ready = preview?.status === "ready" ? preview.value : null;
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const path = await pickImage(t("studio.cv.photo"));
    if (!path) return;
    setBusy(true);
    try {
      const saved = await studioSaveImage({ path });
      useCvStore.getState().updateProfile((profile) => ({ ...profile, photo: saved.path, photoCrop: null }));
      setCropping(true);
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(false);
    }
  };

  const shownCrop = ready && photoCrop ? photoCrop : null;
  const scale = ready && shownCrop ? THUMB / (shownCrop.width * ready.width) : 1;
  const thumbStyle = ready && shownCrop ? { position: "absolute" as const, maxWidth: "none", width: ready.width * scale, height: ready.height * scale, left: -shownCrop.x * ready.width * scale, top: -shownCrop.y * ready.height * scale } : undefined;

  return (
    <div className="flex items-center gap-3">
      <span className={cn("relative flex size-16 shrink-0 items-center justify-center overflow-hidden border border-border bg-muted", round ? "rounded-full" : "rounded-lg")}>
        {ready ? <img src={ready.url} alt="" width={64} height={64} className={shownCrop ? undefined : "size-full object-cover"} style={thumbStyle} /> : <ImagePlus className="size-5 text-muted-foreground" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-medium">{photo ? t("studio.cv.photoReady") : t("studio.cv.noPhoto")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void choose()}>
            {photo ? t("studio.cv.changePhoto") : t("studio.cv.addPhoto")}
          </Button>
          {photo ? (
            <>
              <Button size="sm" variant="ghost" icon={<Crop className="size-4" aria-hidden />} disabled={!ready} onClick={() => setCropping(true)}>
                {t("studio.cv.crop.open")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => useCvStore.getState().updateProfile((profile) => ({ ...profile, photo: null, photoCrop: null }))}>
                {t("studio.cv.removePhoto")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <PhotoCropDialog
        open={cropping && ready !== null}
        image={ready}
        crop={photoCrop}
        round={round}
        onClose={() => setCropping(false)}
        onApply={(crop) => {
          setProfileField("photoCrop", crop, false);
          setCropping(false);
        }}
      />
    </div>
  );
}

function ContactRow({ contact, index, total, dragging, target, onGrip }: { contact: CvContact; index: number; total: number; dragging: boolean; target: boolean; onGrip: ReturnType<ReturnType<typeof usePointerReorder>["begin"]> }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useClaimedFocus(contact.id, inputRef);
  const remove = useRemoveWithUndo("contacts");
  const [touched, setTouched] = useState(false);
  const kindLabel = t(`studio.cv.contactKinds.${contact.kind}`);
  const check = CONTACT_CHECKS[contact.kind];
  const invalid = check !== undefined && touched && !looksValid(check, contact.value);
  const hintId = `cv-contact-${contact.id}`;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = event.currentTarget.closest("[data-reorder-index]")?.nextElementSibling?.querySelector<HTMLInputElement>("input");
    next?.focus();
  };
  return (
    <div data-reorder-index={index} className={cn("rounded-lg", dragging && "opacity-60 ring-2 ring-primary", target && "ring-1 ring-primary")}>
      <div className="flex items-center gap-1">
        <span aria-hidden onPointerDown={onGrip} title={t("studio.cv.drag", { name: kindLabel })} className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground" data-reorder-grip>
          <GripVertical className="size-4" />
        </span>
        <SelectInput aria-label={t("studio.cv.contactKind")} value={contact.kind} onChange={(event) => patchItem("contacts", contact.id, { kind: event.target.value as CvContactKind }, false)} className="w-28 shrink-0">
          {CV_CONTACT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`studio.cv.contactKinds.${kind}`)}
            </option>
          ))}
        </SelectInput>
        <TextInput
          ref={inputRef}
          aria-label={kindLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          value={contact.value}
          maxLength={300}
          placeholder={t(`studio.cv.placeholders.${contact.kind}`)}
          onBlur={() => setTouched(true)}
          onKeyDown={onKeyDown}
          onChange={(event) => patchItem("contacts", contact.id, { value: event.target.value })}
        />
        <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name: kindLabel })} disabled={index === 0} onClick={() => moveItem("contacts", index, index - 1)} />
        <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name: kindLabel })} disabled={index === total - 1} onClick={() => moveItem("contacts", index, index + 1)} />
        <IconButton icon={Trash2} label={t("studio.cv.remove", { name: kindLabel })} onClick={() => remove(contact.id, kindLabel)} />
      </div>
      {invalid && check ? (
        <p id={hintId} className="ms-6 mt-1 text-xs text-warning">
          {t(`studio.cv.checks.${check}`)}
        </p>
      ) : null}
    </div>
  );
}

function ContactsList() {
  const { t } = useTranslation();
  const contacts = useCvStore((state) => state.profile.contacts);
  const room = useCvStore((state) => canAdd(state.profile, "contacts"));
  const { drag, begin } = usePointerReorder((from, to) => moveItem("contacts", from, to));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground/80">{t("studio.cv.sections.contact")}</p>
      <div data-reorder-list className="space-y-2">
        {contacts.map((contact, index) => (
          <ContactRow key={contact.id} contact={contact} index={index} total={contacts.length} dragging={drag?.from === index} target={drag !== null && drag.from !== index && drag.to === index} onGrip={begin(index)} />
        ))}
      </div>
      <MenuButton
        icon={Plus}
        label={t("studio.cv.addContact")}
        disabled={!room}
        items={CV_CONTACT_KINDS.map((kind) => ({ type: "item" as const, id: kind, label: t(`studio.cv.contactKinds.${kind}`), onSelect: () => addItems("contacts", [emptyContact(kind)]) }))}
      />
    </div>
  );
}

export function PersonalSection() {
  const { t } = useTranslation();
  const name = useCvStore((state) => state.profile.name);
  const headline = useCvStore((state) => state.profile.headline);
  return (
    <FormSection title={t("studio.cv.personal")} defaultOpen>
      <PhotoField />
      <TextField label={t("studio.cv.fields.name")} value={name} placeholder={t("studio.cv.placeholders.name")} onChange={(value) => setProfileField("name", value)} />
      <TextField label={t("studio.cv.fields.headline")} value={headline} placeholder={t("studio.cv.placeholders.headline")} onChange={(value) => setProfileField("headline", value)} />
      <ContactsList />
    </FormSection>
  );
}
