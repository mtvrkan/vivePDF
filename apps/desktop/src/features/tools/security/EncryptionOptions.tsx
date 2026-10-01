import type { Dispatch, ReactNode, SetStateAction } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox, Field, Fieldset, PresetRow, Segmented, SelectInput, SwitchField } from "@/components/tool/form";
import { PERMISSION_KEYS, PERMISSION_PRESET_KEYS, PERMISSION_PRESETS } from "@/features/tools/security/permissionSets";
import type { EncryptAlgorithm, Permissions } from "@/types";

const LEGACY_ALGORITHMS: EncryptAlgorithm[] = ["aes128", "rc4"];

export function PermissionsFieldset({ permissions, onPermissions, warning }: {
  permissions: Permissions;
  onPermissions: Dispatch<SetStateAction<Permissions>>;
  warning?: ReactNode;
}) {
  const { t } = useTranslation();
  const activePreset = PERMISSION_PRESET_KEYS.find((key) =>
    PERMISSION_KEYS.every((permission) => permissions[permission] === PERMISSION_PRESETS[key][permission]),
  );
  return (
    <Fieldset title={t("tools.security.encrypt.permissions")}>
      <PresetRow label={t("tools.security.encrypt.presetsLabel")}>
        <Segmented
          value={activePreset ?? ""}
          options={PERMISSION_PRESET_KEYS}
          labelOf={(key) => t(`tools.security.encrypt.presets.${key}`)}
          onChange={(key) => onPermissions((state) => ({ ...state, ...PERMISSION_PRESETS[key] }))}
          ariaLabel={t("tools.security.encrypt.presetsLabel")}
          size="sm"
          className="flex-wrap"
        />
      </PresetRow>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {PERMISSION_KEYS.map((key) => (
          <Checkbox key={key} label={t(`tools.security.encrypt.permission.${key}`)} checked={permissions[key]} onChange={(checked) => onPermissions((state) => ({ ...state, [key]: checked }))} />
        ))}
      </div>
      {warning}
    </Fieldset>
  );
}

export function AlgorithmAndMetadata({ algorithm, onAlgorithm, encryptMetadata, onEncryptMetadata, allowRc4 = true }: {
  algorithm: EncryptAlgorithm;
  onAlgorithm: (value: EncryptAlgorithm) => void;
  encryptMetadata: boolean;
  onEncryptMetadata: (value: boolean) => void;
  allowRc4?: boolean;
}) {
  const { t } = useTranslation();
  const legacy = LEGACY_ALGORITHMS.filter((value) => allowRc4 || value !== "rc4");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.security.encrypt.algorithm")}>
          <SelectInput value={algorithm} aria-label={t("tools.security.encrypt.algorithm")} onChange={(event) => onAlgorithm(event.target.value as EncryptAlgorithm)}>
            <option value="aes256">{t("tools.security.encrypt.algorithms.aes256")}</option>
            <optgroup label={t("tools.security.encrypt.legacyGroup")}>
              {legacy.map((value) => (
                <option key={value} value={value}>
                  {t(`tools.security.encrypt.algorithms.${value}`)}
                </option>
              ))}
            </optgroup>
          </SelectInput>
        </Field>
      </div>
      {algorithm !== "aes256" ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t(`tools.security.encrypt.legacyWarning.${algorithm}`)}
        </p>
      ) : null}
      <SwitchField label={t("tools.security.encrypt.encryptMetadata")} hint={t("tools.security.encrypt.encryptMetadataHint")} checked={encryptMetadata} onChange={onEncryptMetadata} />
    </>
  );
}
