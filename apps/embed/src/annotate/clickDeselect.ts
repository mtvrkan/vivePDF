export function shouldDeselectAfterClick(selectedAtPress: readonly string[], selectedNow: readonly string[]): boolean {
  if (selectedNow.length === 0) return false;
  if (selectedNow.length !== selectedAtPress.length) return false;
  const atPress = new Set(selectedAtPress);
  return selectedNow.every((uid) => atPress.has(uid));
}
