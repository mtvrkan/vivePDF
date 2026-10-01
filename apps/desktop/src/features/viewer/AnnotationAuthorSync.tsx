import { useEffect } from "react";
import { useAnnotationPlugin } from "@embedpdf/plugin-annotation/react";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { annotationAuthorName } from "./annotationAuthor";

export function AnnotationAuthorSync() {
  const { plugin } = useAnnotationPlugin();
  const preference = usePreferencesStore((state) => state.annotationAuthor);

  useEffect(() => {
    if (plugin) plugin.config.annotationAuthor = annotationAuthorName(preference);
  }, [plugin, preference]);

  return null;
}
