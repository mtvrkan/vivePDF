import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox } from "@/components/tool/form";
import { toRpcError } from "@/shared/rpc/client";
import { fileAssociationEnabled, setFileAssociation, setSendTo, setShellIntegration } from "@/shared/rpc/files";
import { useToastStore } from "@/shared/store/toastStore";
import type { DefaultPdfApp } from "@/shared/hooks/useDefaultPdfApp";
import { describeError } from "@/shared/lib/errorMessage";
import { shellMenuEntries } from "@/shared/lib/shellMenu";
import { SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function SystemSection({
  query,
  onEmptyChange,
  shellSupported,
  defaultApp,
  shellEnabled,
  setShellEnabled,
  shellBusy,
  setShellBusy,
  associationEnabled,
  setAssociationEnabled,
  associationBusy,
  setAssociationBusy,
  sendToEnabledState,
  setSendToEnabledState,
  sendToBusy,
  setSendToBusy,
}: SettingsSectionProps & {
  shellSupported: boolean;
  defaultApp: DefaultPdfApp;
  shellEnabled: boolean;
  setShellEnabled: (value: boolean) => void;
  shellBusy: boolean;
  setShellBusy: (value: boolean) => void;
  associationEnabled: boolean;
  setAssociationEnabled: (value: boolean) => void;
  associationBusy: boolean;
  setAssociationBusy: (value: boolean) => void;
  sendToEnabledState: boolean;
  setSendToEnabledState: (value: boolean) => void;
  sendToBusy: boolean;
  setSendToBusy: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);

  const toggleShellIntegration = async (enabled: boolean) => {
    setShellBusy(true);
    try {
      const next = await setShellIntegration(enabled, t("app.name"), shellMenuEntries(t));
      setShellEnabled(next);
      toast("success", t(next ? "settings.shellMenuEnabled" : "settings.shellMenuDisabled"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setShellBusy(false);
    }
  };

  const toggleFileAssociation = async (enabled: boolean) => {
    setAssociationBusy(true);
    try {
      const next = await setFileAssociation(enabled, t("app.name"), t("settings.system.associationType"));
      setAssociationEnabled(next);
      toast("success", t(next ? "settings.system.associationEnabled" : "settings.system.associationDisabled"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setAssociationBusy(false);
    }
  };

  const makeDefault = async () => {
    await defaultApp.makeDefault();
    if (shellSupported) setAssociationEnabled(await fileAssociationEnabled());
  };

  const defaultStatus = defaultApp.status;
  const defaultHint = defaultStatus?.isDefault
    ? t("defaultApp.isDefault")
    : defaultStatus?.current
      ? t("defaultApp.current", { name: defaultStatus.current })
      : t("defaultApp.none");

  const toggleSendTo = async (enabled: boolean) => {
    setSendToBusy(true);
    try {
      const next = await setSendTo(enabled, t("app.name"), t("settings.system.sendToDescription"));
      setSendToEnabledState(next);
      toast("success", t(next ? "settings.system.sendToEnabled" : "settings.system.sendToDisabled"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setSendToBusy(false);
    }
  };

  return (
    <SectionCard id="system" query={query} onEmptyChange={onEmptyChange}>
      {defaultStatus?.supported ? (
        <SettingRow label={t("defaultApp.title")} hintTone={defaultStatus.isDefault ? "success" : undefined} hint={shellSupported && !defaultStatus.isDefault ? `${defaultHint} ${t("defaultApp.windowsNote")}` : defaultHint}>
          {defaultStatus.isDefault ? (
            <Check className="size-4 text-success" aria-label={t("defaultApp.isDefault")} />
          ) : (
            <Button size="sm" loading={defaultApp.busy} disabled={defaultApp.busy} onClick={() => void makeDefault()}>
              {t("defaultApp.make")}
            </Button>
          )}
        </SettingRow>
      ) : null}
      {shellSupported ? (
        <>
          <SettingRow label={t("settings.system.association")} hint={t("settings.system.associationHint")}>
            <Checkbox label="" checked={associationEnabled} disabled={associationBusy} onChange={(checked) => void toggleFileAssociation(checked)} />
          </SettingRow>
          <SettingRow label={t("settings.shellMenu")} hint={t("settings.shellMenuHint")}>
            <Checkbox label="" checked={shellEnabled} disabled={shellBusy} onChange={(checked) => void toggleShellIntegration(checked)} />
          </SettingRow>
          <SettingRow label={t("settings.system.sendTo")} hint={t("settings.system.sendToHint")}>
            <Checkbox label="" checked={sendToEnabledState} disabled={sendToBusy} onChange={(checked) => void toggleSendTo(checked)} />
          </SettingRow>
        </>
      ) : null}
    </SectionCard>
  );
}
