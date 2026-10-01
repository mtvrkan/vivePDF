import { useState } from "react";
import { readMarkPresets, writeMarkPresets, type MarkPreset } from "@/features/tools/security/markPresetStore";
import type { SecurityTab } from "@/features/tools/security/securityForm";
import type { StampSettings } from "@/features/tools/security/useStampForm";
import type { WatermarkSettings } from "@/features/tools/security/useWatermarkForm";

type PresetForm<Settings> = { settings: () => Settings; apply: (mark: Record<string, unknown>) => void };

export function useMarkPresets(tab: SecurityTab, watermark: PresetForm<WatermarkSettings>, stamp: PresetForm<StampSettings>) {
  const [presets, setPresets] = useState<MarkPreset[]>(() => readMarkPresets());
  const [presetName, setPresetName] = useState("");
  const onTab = (item: MarkPreset) => (tab === "stamp" ? item.stamp : item.watermark) !== undefined;

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const entry: MarkPreset = tab === "stamp" ? { name, stamp: stamp.settings() } : { name, watermark: watermark.settings() };
    const next = [entry, ...presets.filter((item) => item.name !== name || !onTab(item))];
    setPresets(next);
    writeMarkPresets(next);
    setPresetName("");
  };

  const tabPresets = presets.filter(onTab);

  const dropPreset = (name: string) => {
    const next = presets.filter((item) => item.name !== name || !onTab(item));
    setPresets(next);
    writeMarkPresets(next);
  };

  const applyPreset = (item: MarkPreset) => {
    if (tab === "stamp") {
      if (item.stamp) stamp.apply(item.stamp);
    } else if (item.watermark) {
      watermark.apply(item.watermark);
    }
  };

  return { tabPresets, presetName, setPresetName, savePreset, dropPreset, applyPreset };
}
