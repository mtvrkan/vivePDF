const MISSING_STATE = "Annotation state not found";

export function annotationStateOf<T>(scope: { getState: () => T }): T | null {
  try {
    return scope.getState();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(MISSING_STATE)) return null;
    throw error;
  }
}
