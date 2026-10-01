import { cleanCopiedText } from "@/shared/lib/copyText";

type SelectionLike = { getSelectedText: () => { toPromise: () => Promise<string[]> } };

export async function copySelection(scope: SelectionLike | null | undefined): Promise<boolean> {
  if (!scope) return false;
  try {
    const lines = await scope.getSelectedText().toPromise();
    const text = cleanCopiedText(lines);
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
