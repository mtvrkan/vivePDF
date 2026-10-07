import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Checkbox, Segmented, TextInput } from "@/components/tool/form";
import { MAX_AUTHOR_LENGTH, VIEWER_SCROLLS, VIEWER_ZOOMS, usePreferencesStore, type ViewerScroll, type ViewerZoom } from "@/shared/store/preferencesStore";
import { PAGES_ZOOM_MAX, PAGES_ZOOM_MIN, useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { DEFAULT_ANNOTATION_AUTHOR } from "@/features/viewer/annotationAuthor";
import { RangeControl, SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function ViewerSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const pagesZoom = useUiStore((state) => state.pagesZoom);
  const setPagesZoom = useUiStore((state) => state.setPagesZoom);
  const viewerZoom = usePreferencesStore((state) => state.viewerZoom);
  const viewerSpread = usePreferencesStore((state) => state.viewerSpread);
  const viewerScroll = usePreferencesStore((state) => state.viewerScroll);
  const selectionColor = usePreferencesStore((state) => state.selectionColor);
  const annotationAuthor = usePreferencesStore((state) => state.annotationAuthor);
  const selectionToolbar = usePreferencesStore((state) => state.selectionToolbar);
  const reloadOnFileChange = usePreferencesStore((state) => state.reloadOnFileChange);
  const updatePreferences = usePreferencesStore((state) => state.update);
  const panels = useViewerPanelsStore((state) => state.panels);
  const togglePanel = useViewerPanelsStore((state) => state.toggle);

  return (
    <SectionCard id="viewer" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.viewer.thumbnailSize")} hint={t("settings.viewer.thumbnailSizeHint")}>
        <RangeControl value={pagesZoom} min={PAGES_ZOOM_MIN} max={PAGES_ZOOM_MAX} step={10} display={`${pagesZoom} px`} onChange={setPagesZoom} ariaLabel={t("settings.viewer.thumbnailSize")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.panelThumbnails")}>
        <Checkbox label="" checked={panels.thumbnails} onChange={() => togglePanel("thumbnails")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.panelOutline")}>
        <Checkbox label="" checked={panels.outline} onChange={() => togglePanel("outline")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.panelInspector")}>
        <Checkbox label="" checked={panels.inspector} onChange={() => togglePanel("inspector")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.panelComments")}>
        <Checkbox label="" checked={panels.comments} onChange={() => togglePanel("comments")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.zoom")} hint={t("settings.viewer.zoomHint")}>
        <Segmented size="sm" value={viewerZoom} options={VIEWER_ZOOMS} labelOf={(option) => t(`settings.viewer.zooms.${option}`)} onChange={(value: ViewerZoom) => updatePreferences({ viewerZoom: value })} ariaLabel={t("settings.viewer.zoom")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.spread")} hint={t("settings.viewer.spreadHint")}>
        <Checkbox label="" checked={viewerSpread} onChange={(value) => updatePreferences({ viewerSpread: value })} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.scroll")} hint={t("settings.viewer.scrollHint")}>
        <Segmented size="sm" value={viewerScroll} options={VIEWER_SCROLLS} labelOf={(option) => t(`viewer.pageDisplay.${option}`)} onChange={(value: ViewerScroll) => updatePreferences({ viewerScroll: value })} ariaLabel={t("settings.viewer.scroll")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.selectionToolbar")} hint={t("settings.viewer.selectionToolbarHint")}>
        <Checkbox label="" checked={selectionToolbar} onChange={(value) => updatePreferences({ selectionToolbar: value })} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.reloadOnFileChange")} hint={t("settings.viewer.reloadOnFileChangeHint")}>
        <Checkbox label="" checked={reloadOnFileChange} onChange={(value) => updatePreferences({ reloadOnFileChange: value })} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.selectionColor")} hint={t("settings.viewer.selectionColorHint")}>
        <ColorSwatch value={selectionColor} onChange={(value) => updatePreferences({ selectionColor: value })} label={t("settings.viewer.selectionColor")} customLabel={t("colorPicker.custom")} />
      </SettingRow>
      <SettingRow label={t("settings.viewer.annotationAuthor")} hint={t("settings.viewer.annotationAuthorHint")}>
        <TextInput value={annotationAuthor} onChange={(event) => updatePreferences({ annotationAuthor: event.target.value.slice(0, MAX_AUTHOR_LENGTH) })} placeholder={DEFAULT_ANNOTATION_AUTHOR} maxLength={MAX_AUTHOR_LENGTH} aria-label={t("settings.viewer.annotationAuthor")} className="w-64" />
      </SettingRow>
    </SectionCard>
  );
}
