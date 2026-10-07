import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { DocumentInfo, SignatureInfo } from "@/types";
import { axeViolations } from "@/test/axe";
import { DocumentMessageBar } from "./DocumentMessageBar";
import { loadedFields, useFormFillStore } from "./forms/formFillStore";

const rpc = vi.hoisted(() => ({ countSignatures: vi.fn(), verifySignatures: vi.fn(), listFormFields: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => rpc);

const DOCUMENT_ID = "doc-messages";

const signature: SignatureInfo = {
  fieldName: "Signature1",
  signer: "Ada Lovelace",
  signedAt: null,
  intact: true,
  valid: true,
  trusted: true,
  trustSource: "user",
  trustProblem: null,
  revoked: null,
  coverage: "ENTIRE_FILE",
  modificationLevel: null,
  reason: null,
  location: null,
  summary: "",
  modified: false,
  certified: false,
  permission: null,
};

function openDocument(hasForms: boolean) {
  const info = { hasForms } as DocumentInfo;
  useDocumentStore.getState().register(DOCUMENT_ID, `C:/docs/${hasForms ? "form" : "signed"}-${Math.random()}.pdf`, null);
  useDocumentStore.setState((state) => ({ documents: { ...state.documents, [DOCUMENT_ID]: { ...state.documents[DOCUMENT_ID], info, infoStatus: "success" } } }));
}

async function renderBar(onOpenSignatures = vi.fn()) {
  let container: HTMLElement = document.body;
  await act(async () => {
    container = render(<DocumentMessageBar documentId={DOCUMENT_ID} onOpenSignatures={onOpenSignatures} />).container;
  });
  return { onOpen: onOpenSignatures, container };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  rpc.countSignatures.mockReset();
  rpc.verifySignatures.mockReset();
  rpc.listFormFields.mockReset();
  useDocumentMessagesStore.getState().forget(DOCUMENT_ID);
});

afterEach(() => {
  cleanup();
  useDocumentStore.getState().remove(DOCUMENT_ID);
});

describe("DocumentMessageBar", () => {
  it("says a signed document is valid and opens the signature panel", async () => {
    rpc.countSignatures.mockResolvedValue({ count: 1 });
    rpc.verifySignatures.mockResolvedValue({ signatures: [signature] });
    openDocument(false);
    const { onOpen, container } = await renderBar();
    expect(await screen.findByText("Signed and all signatures are valid.")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    expect(rpc.verifySignatures).toHaveBeenCalledWith(expect.objectContaining({ online: false }));
    fireEvent.click(screen.getByRole("button", { name: "Signature panel" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("warns when a signature is broken and hides the row once dismissed", async () => {
    rpc.countSignatures.mockResolvedValue({ count: 1 });
    rpc.verifySignatures.mockResolvedValue({ signatures: [{ ...signature, modified: true }] });
    openDocument(false);
    await renderBar();
    expect(await screen.findByText("At least one signature is invalid or the document changed after signing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close message" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing for an unsigned document without fields and skips verifying", async () => {
    rpc.countSignatures.mockResolvedValue({ count: 0 });
    openDocument(false);
    await renderBar();
    expect(screen.queryByRole("status")).toBeNull();
    expect(rpc.verifySignatures).not.toHaveBeenCalled();
    expect(useDocumentMessagesStore.getState().signatures[DOCUMENT_ID]).toEqual({ state: "none" });
  });

  it("offers to highlight form fields and keeps their boxes while switched on", async () => {
    rpc.countSignatures.mockResolvedValue({ count: 0 });
    const boxes = [{ name: "name", page: 1, left: 0.1, top: 0.1, width: 0.4, height: 0.05 }];
    rpc.listFormFields.mockResolvedValue({ fields: [], isForm: true, xfa: false, boxes });
    openDocument(true);
    await renderBar();
    expect(screen.getByText("This document has fillable form fields.")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Highlight fields" });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useDocumentMessagesStore.getState().highlights[DOCUMENT_ID]).toEqual({ state: "shown", boxes });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useDocumentMessagesStore.getState().highlights[DOCUMENT_ID]).toBeUndefined();
  });

  it("leaves the fillable-fields row out for a form only XFA can fill", async () => {
    rpc.countSignatures.mockResolvedValue({ count: 0 });
    openDocument(true);
    useFormFillStore.setState({ loads: { [DOCUMENT_ID]: loadedFields({ fields: [], isForm: true, xfa: true, boxes: [] }) } });

    await renderBar();

    expect(screen.queryByText("This document has fillable form fields.")).toBeNull();
    useFormFillStore.setState({ loads: {} });
  });

  it("marks the check as failed when the engine cannot read the signatures", async () => {
    rpc.countSignatures.mockRejectedValue(new Error("engine gone"));
    openDocument(false);
    await renderBar();
    expect(useDocumentMessagesStore.getState().signatures[DOCUMENT_ID]).toEqual({ state: "failed" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
