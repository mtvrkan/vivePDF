import { annotateError } from "../api/errors";
import type { VivePdfAnnotateError } from "../api/types";
import type { AnnotateApi, AnnotateCommand } from "./bridge";

function asAnnotateError(error: unknown): VivePdfAnnotateError {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error as VivePdfAnnotateError;
  return annotateError("failed", error instanceof Error ? error.message : "the drawing tools could not finish");
}

export function answerAnnotate(api: AnnotateApi | null, command: AnnotateCommand): void {
  if (command.kind === "setTool") {
    api?.chooseTool(command.tool);
    return;
  }
  if (!api) {
    command.reply.reject(annotateError("annotate-off", "the drawing tools are off; add the annotate attribute"));
    return;
  }
  try {
    if (command.kind === "annotations") command.reply.resolve(api.list());
    else if (command.kind === "setAnnotations") {
      api.replace(command.list);
      command.reply.resolve();
    } else api.save().then(command.reply.resolve, (error: unknown) => command.reply.reject(asAnnotateError(error)));
  } catch (error) {
    command.reply.reject(asAnnotateError(error));
  }
}
