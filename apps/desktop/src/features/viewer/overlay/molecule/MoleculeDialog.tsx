import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Atom } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { SwitchField, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { shapeDataUrl } from "../shapes/render";
import type { MoleculeDrawing } from "./moleculeEngine";
import { cleanSmiles, MAX_SMILES_CHARS, MOLECULE_EXAMPLES, type MoleculeSettings } from "./moleculeModel";
import type { MoleculeSource } from "./moleculeObject";

type Engine = { drawMolecule: (smiles: string, look: Omit<MoleculeSettings, "smiles">) => MoleculeDrawing };
type EngineState = { status: "loading" } | { status: "ready"; engine: Engine } | { status: "failed" };
type Preview = { key: string; drawing: MoleculeDrawing } | null;

const PREVIEW_DELAY_MS = 150;

function loadEngine(): Promise<Engine> {
  return import("./moleculeEngine");
}

function previewKey(settings: MoleculeSettings): string {
  return JSON.stringify({ ...settings, smiles: cleanSmiles(settings.smiles) });
}

export function MoleculeDialog({ initial, updating, onClose, onSubmit }: { initial: MoleculeSettings; updating: boolean; onClose: () => void; onSubmit: (source: MoleculeSource) => void }) {
  const { t } = useTranslation();
  const smilesId = useId();
  const hintId = useId();
  const statusId = useId();
  const [engineState, setEngineState] = useState<EngineState>({ status: "loading" });
  const [settings, setSettings] = useState<MoleculeSettings>(initial);
  const [preview, setPreview] = useState<Preview>(null);

  const update = (change: Partial<MoleculeSettings>) => setSettings((current) => ({ ...current, ...change }));
  const key = previewKey(settings);
  const blank = !cleanSmiles(settings.smiles);

  useEffect(() => {
    if (engineState.status !== "loading") return;
    let cancelled = false;
    loadEngine().then(
      (engine) => {
        if (!cancelled) setEngineState({ status: "ready", engine });
      },
      () => {
        if (!cancelled) setEngineState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engineState.status]);

  const engine = engineState.status === "ready" ? engineState.engine : null;

  useEffect(() => {
    if (!engine || blank) return;
    const { smiles, ...look } = settings;
    const timer = window.setTimeout(() => setPreview({ key, drawing: engine.drawMolecule(smiles, look) }), PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [engine, blank, key, settings]);

  const current = preview && preview.key === key ? preview.drawing : null;
  const drawn = current && "svg" in current ? current : null;
  const failure = current && "error" in current ? current : null;

  const submit = () => {
    if (!drawn) return;
    onSubmit({ settings: { ...settings, smiles: cleanSmiles(settings.smiles) }, svg: drawn.svg, width: drawn.width, height: drawn.height });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const failureMessage = () => {
    if (!failure) return null;
    if (failure.error === "drawFailed") return t("viewer.molecule.drawFailed");
    return failure.position === null ? t("viewer.molecule.invalid") : t("viewer.molecule.invalidAt", { position: failure.position });
  };

  const previewBody = () => {
    if (engineState.status === "failed") return <ErrorState title={t("viewer.molecule.engineErrorTitle")} message={t("viewer.molecule.engineErrorMessage")} onRetry={() => setEngineState({ status: "loading" })} />;
    if (blank) {
      return (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Atom className="size-7 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{t("viewer.molecule.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.molecule.emptyHint")}</p>
        </div>
      );
    }
    if (drawn) return <img src={shapeDataUrl(drawn.svg)} alt={t("viewer.molecule.previewAlt", { smiles: cleanSmiles(settings.smiles) })} draggable={false} className="max-h-64 max-w-full object-contain" style={{ width: drawn.width * 1.5 }} />;
    if (failure) return <p className="text-center text-sm text-destructive">{failureMessage()}</p>;
    return (
      <div className="flex w-full flex-col items-center gap-2" aria-hidden>
        <div className="size-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    );
  };

  return (
    <Dialog
      open
      size="lg"
      title={updating ? t("viewer.molecule.editTitle") : t("viewer.molecule.title")}
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-xs text-muted-foreground">{t("viewer.molecule.shortcutHint")}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!drawn}>
            {updating ? t("viewer.molecule.update") : t("viewer.molecule.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div id={statusId} role="status" aria-live="polite" aria-busy={!blank && !current && engineState.status !== "failed" ? true : undefined} className={cn("paper-surface flex min-h-48 items-center justify-center rounded-xl border bg-white p-4", failure && "border-destructive/60")}>
          {previewBody()}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={smilesId} className="text-sm font-medium text-foreground/80">
            {t("viewer.molecule.smilesLabel")}
          </label>
          <TextInput
            id={smilesId}
            autoFocus
            value={settings.smiles}
            maxLength={MAX_SMILES_CHARS}
            onChange={(event) => update({ smiles: event.target.value })}
            onKeyDown={onKeyDown}
            dir="ltr"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            placeholder="CC(=O)Oc1ccccc1C(=O)O"
            aria-describedby={`${hintId} ${statusId}`}
            aria-invalid={failure ? true : undefined}
            className="font-mono"
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {t("viewer.molecule.smilesHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground/80">{t("viewer.molecule.examples")}</span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {MOLECULE_EXAMPLES.map((example) => (
              <Button key={example.id} size="sm" variant="secondary" onClick={() => update({ smiles: example.smiles })} title={example.smiles}>
                {t(`viewer.molecule.names.${example.id}`)}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-sm">
            <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.molecule.color")} customLabel={t("viewer.overlay.customColor")} />
            {t("viewer.molecule.color")}
          </span>
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchField label={t("viewer.molecule.colorAtoms")} checked={settings.colorAtoms} onChange={(colorAtoms) => update({ colorAtoms })} />
            <SwitchField label={t("viewer.molecule.terminalCarbons")} checked={settings.terminalCarbons} onChange={(terminalCarbons) => update({ terminalCarbons })} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
