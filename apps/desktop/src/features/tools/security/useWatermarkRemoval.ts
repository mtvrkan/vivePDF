import { useCallback, useEffect, useRef, useState } from "react";
import type { SecurityTab } from "@/features/tools/security/securityForm";
import { toRpcError } from "@/shared/rpc/client";
import { detectWatermark } from "@/shared/rpc/operations";
import type { DocumentInfo, RpcError, WatermarkCandidate } from "@/types";

type RemovalSource = { tab: SecurityTab; sourcePath: string | null; sourcePassword: string | undefined; info: DocumentInfo | null | undefined };

export function useWatermarkRemoval({ tab, sourcePath, sourcePassword, info }: RemovalSource) {
  const [removeText, setRemoveText] = useState("");
  const [removeAnnotations, setRemoveAnnotations] = useState(false);
  const [removeImages, setRemoveImages] = useState(false);
  const [removePages, setRemovePages] = useState("");
  const [found, setFound] = useState<WatermarkCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<RpcError | null>(null);
  const [pagesScanned, setPagesScanned] = useState(0);
  const request = useRef(0);

  const findWatermarks = useCallback(async () => {
    const ticket = ++request.current;
    if (!sourcePath) return;
    setFinding(true);
    setFindError(null);
    try {
      const result = await detectWatermark({ path: sourcePath, password: sourcePassword });
      if (ticket !== request.current) return;
      setFound(result.candidates);
      setPagesScanned(result.pagesScanned);
      setChosen(Object.fromEntries(result.candidates.map((candidate) => [candidate.id, candidate.confident])));
    } catch (error) {
      if (ticket !== request.current) return;
      setFound(null);
      setPagesScanned(0);
      setFindError(toRpcError(error));
    } finally {
      if (ticket === request.current) setFinding(false);
    }
  }, [sourcePath, sourcePassword]);

  useEffect(() => {
    request.current += 1;
    setFinding(false);
    setFound(null);
    setChosen({});
    setFindError(null);
    setPagesScanned(0);
    if (tab === "removeWatermark" && sourcePath && info) void findWatermarks();
  }, [tab, sourcePath, info, findWatermarks]);

  const chosenCandidates = (found ?? []).filter((candidate) => chosen[candidate.id]);
  const chosenTexts = chosenCandidates.filter((candidate) => candidate.kind === "text" && candidate.text).map((candidate) => candidate.text as string);
  const chosenDigests = chosenCandidates.filter((candidate) => candidate.kind === "image" && candidate.digest).map((candidate) => candidate.digest as string);
  const chosenAnnotations = chosenCandidates.some((candidate) => candidate.kind === "annotation");
  const chosenStampAnnotations = chosenCandidates.some((candidate) => candidate.kind === "stampAnnotation");
  const chosenTagged = chosenCandidates.some((candidate) => candidate.kind === "tagged");
  const chosenArtifacts = chosenCandidates.some((candidate) => candidate.kind === "artifact");
  const chosenLayers = chosenCandidates.filter((candidate) => candidate.kind === "layer" && candidate.layer).map((candidate) => candidate.layer as number);
  const chosenRaster = chosenCandidates.some((candidate) => candidate.kind === "raster");

  return {
    removeText,
    setRemoveText,
    removeAnnotations,
    setRemoveAnnotations,
    removeImages,
    setRemoveImages,
    removePages,
    setRemovePages,
    found,
    chosen,
    setChosen,
    finding,
    findError,
    pagesScanned,
    findWatermarks,
    chosenCandidates,
    chosenTexts,
    chosenDigests,
    chosenAnnotations,
    chosenStampAnnotations,
    chosenTagged,
    chosenArtifacts,
    chosenLayers,
    chosenRaster,
  };
}
