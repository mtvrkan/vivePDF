import { rpc } from "./client";
import type { DocumentInfo, InfoGetParams, PageLabelsParams, PageLabelsResult, SystemPingResult, SystemReleaseParams, SystemReleaseResult } from "@/types";

export function getDocumentInfo(params: InfoGetParams): Promise<DocumentInfo> {
  return rpc<DocumentInfo>("info.get", params);
}

export function getPageLabels(params: PageLabelsParams): Promise<PageLabelsResult> {
  return rpc<PageLabelsResult>("info.page_labels", params);
}

export function pingEngine(): Promise<SystemPingResult> {
  return rpc<SystemPingResult>("system.ping");
}

export function releaseDocuments(params: SystemReleaseParams = {}): Promise<SystemReleaseResult> {
  return rpc<SystemReleaseResult>("system.release", params);
}
