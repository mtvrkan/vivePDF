import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import type { TrustListResult, TrustListSignature, TrustPreviewResult, TrustRoot, TrustSource } from "@/types";

const listTrustRoots = vi.fn();
const addTrustRoot = vi.fn();
const previewTrustRoots = vi.fn();
const removeTrustRoot = vi.fn();
const clearTrustRoots = vi.fn();
const openDialog = vi.fn();

vi.mock("@/shared/rpc/operations", () => ({
  listTrustRoots: (...args: unknown[]) => listTrustRoots(...args),
  addTrustRoot: (...args: unknown[]) => addTrustRoot(...args),
  previewTrustRoots: (...args: unknown[]) => previewTrustRoots(...args),
  removeTrustRoot: (...args: unknown[]) => removeTrustRoot(...args),
  clearTrustRoots: (...args: unknown[]) => clearTrustRoots(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));

const { TrustRootsSection } = await import("./TrustRootsSection");

const root = (id: string, subject: string): TrustRoot => ({
  id,
  subject,
  issuer: subject,
  fingerprint: `${id}`.padEnd(64, "0"),
  validFrom: "2024-01-01T00:00:00+00:00",
  validUntil: "2040-01-01T00:00:00+00:00",
  authority: true,
  selfSigned: true,
  expired: false,
  lists: [],
});

const german: TrustSource = { kind: "euTrustedList", territory: "DE", name: "Bundesnetzagentur" };

const DIGEST = "ab".repeat(32);
const SIGNER_FINGERPRINT = "D79B88419E005F509DBC12BFC54DDEC6FE7E8944D2FD0344AFCC0249DE26A6DF";

const signature = (status: TrustListSignature["status"]): TrustListSignature => ({
  status,
  signer: status === "unsigned" ? null : { subject: "List Signer", issuer: "Signer CA", fingerprint: SIGNER_FINGERPRINT, validFrom: "2025-01-01T00:00:00+00:00", validUntil: "2029-07-21T00:00:00+00:00", expired: false },
  signedAt: status === "unsigned" ? null : "2026-09-03T10:40:58+00:00",
  stale: false,
  nextUpdate: "2027-03-03T11:07:09+00:00",
});

const listPreview = (fields: Partial<TrustPreviewResult>): TrustPreviewResult => ({ source: german, added: [], known: 0, withdrawn: [], signature: signature("verified"), digest: DIGEST, pinned: 0, ...fields });

const filled: TrustListResult = { roots: [root("a.cer", "Root A"), root("b.cer", "Root B")], unreadable: [] };
const empty: TrustListResult = { roots: [], unreadable: [] };

beforeEach(() => {
  useToastStore.setState({ toasts: [], held: false });
  listTrustRoots.mockReset().mockResolvedValue(filled);
  addTrustRoot.mockReset();
  previewTrustRoots.mockReset();
  removeTrustRoot.mockReset();
  clearTrustRoots.mockReset();
  openDialog.mockReset();
});

afterEach(cleanup);

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("TrustRootsSection", () => {
  it("removes every root only after the inline confirmation", async () => {
    const onChanged = vi.fn();
    const { container } = render(<TrustRootsSection onChanged={onChanged} />);
    await screen.findByText("Root A");

    await click("Remove all");
    expect(screen.getByRole("group", { name: "Remove all" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await click("Cancel");
    expect(clearTrustRoots).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Remove all" })).toBeNull();

    clearTrustRoots.mockResolvedValue({ removed: 2 });
    listTrustRoots.mockResolvedValue(empty);
    await click("Remove all");
    await click("Remove all");
    expect(clearTrustRoots).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("No trusted roots yet")).toBeTruthy();
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["success"]);
  });

  it("offers trust lists in the file dialog and explains a refused list", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    openDialog.mockResolvedValue("C:/lists/eu-lotl.xml");
    previewTrustRoots.mockRejectedValue(new RpcCallError({ code: "INVALID_PARAMS", message: "tampered", data: { reason: "trustListSignatureInvalid" } }));

    await click("Add certificate or trust list");
    const extensions = (openDialog.mock.calls[0][0] as { filters: { extensions: string[] }[] }).filters[0].extensions;
    expect(extensions).toEqual(expect.arrayContaining(["cer", "pem", "xml", "pdf", "acrobatsecuritysettings"]));
    expect(previewTrustRoots).toHaveBeenCalledWith({ path: "C:/lists/eu-lotl.xml" });
    expect(addTrustRoot).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.kind)).toEqual(["error"]);
    expect(toasts[0].message).toContain("changed after signing");
  });

  it("shows a list's source, count, subjects and withdrawn roots before adding it", async () => {
    const onChanged = vi.fn();
    const { container } = render(<TrustRootsSection onChanged={onChanged} />);
    await screen.findByText("Root A");
    const incoming = Array.from({ length: 10 }, (_, index) => root(`n${index}.cer`, `Provider ${index}`));
    const preview = listPreview({ added: incoming, known: 2, withdrawn: [root("old.cer", "Withdrawn Provider")] });
    previewTrustRoots.mockResolvedValue(preview);
    openDialog.mockResolvedValue("C:/lists/de.xml");

    await click("Add certificate or trust list");
    const panel = screen.getByRole("group", { name: "Review before adding" });
    expect(panel.textContent).toContain("Trust list: Bundesnetzagentur (DE)");
    expect(panel.textContent).toContain("New roots: 10 · already trusted: 2");
    expect(panel.textContent).toContain("Provider 7");
    expect(panel.textContent).not.toContain("Provider 8");
    expect(panel.textContent).toContain("and 2 more");
    expect(panel.textContent).toContain("No longer in this list, will stop being trusted: 1");
    expect(panel.textContent).toContain("Withdrawn Provider");
    expect(addTrustRoot).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);

    addTrustRoot.mockResolvedValue({ added: incoming, known: 2, withdrawn: 1 });
    listTrustRoots.mockResolvedValue({ roots: [{ ...root("n0.cer", "Provider 0"), lists: [german] }], unreadable: [] });
    await click("Add these roots");
    expect(addTrustRoot).toHaveBeenCalledWith({ path: "C:/lists/de.xml", expectedDigest: DIGEST, acceptUnverified: false });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: "Review before adding" })).toBeNull();
    expect(await screen.findByText("From trust list: Bundesnetzagentur (DE)")).toBeTruthy();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.kind)).toEqual(["success"]);
    expect(toasts[0].message).toBe("Added: 10 · already in the list: 2 · no longer trusted: 1");
  });

  it("adds nothing when the review is cancelled", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    previewTrustRoots.mockResolvedValue(listPreview({ source: { kind: "securitySettings", territory: null, name: null }, added: [root("c.cer", "Root C")], signature: signature("unsigned") }));
    openDialog.mockResolvedValue("C:/lists/aatl.acrobatsecuritysettings");

    await click("Add certificate or trust list");
    expect(screen.getByRole("group", { name: "Review before adding" }).textContent).toContain("Trust list: Adobe trust list");
    await click("Cancel");
    expect(addTrustRoot).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Review before adding" })).toBeNull();
  });

  it("adds a single certificate at once and only reports a file with nothing new", async () => {
    const onChanged = vi.fn();
    render(<TrustRootsSection onChanged={onChanged} />);
    await screen.findByText("Root A");
    openDialog.mockResolvedValue("C:/certs/c.cer");
    previewTrustRoots.mockResolvedValue(listPreview({ source: null, added: [root("c.cer", "Root C")], signature: null }));
    addTrustRoot.mockResolvedValue({ added: [root("c.cer", "Root C")], known: 0, withdrawn: 0 });

    await click("Add certificate or trust list");
    expect(addTrustRoot).toHaveBeenCalledWith({ path: "C:/certs/c.cer", expectedDigest: DIGEST, acceptUnverified: false });
    expect(screen.queryByRole("group", { name: "Review before adding" })).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);

    previewTrustRoots.mockResolvedValue(listPreview({ source: null, known: 1, signature: null }));
    await click("Add certificate or trust list");
    expect(addTrustRoot).toHaveBeenCalledTimes(1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.kind)).toEqual(["success", "info"]);
    expect(toasts[1].message).toBe("Added: 0 · already in the list: 1");
  });

  it("shows an unconfirmed signer and adds the list only after the override is ticked", async () => {
    const onChanged = vi.fn();
    const { container } = render(<TrustRootsSection onChanged={onChanged} />);
    await screen.findByText("Root A");
    previewTrustRoots.mockResolvedValue(listPreview({ added: [root("n.cer", "Provider N")], signature: signature("unpinned") }));
    openDialog.mockResolvedValue("C:/lists/is.xml");

    await click("Add certificate or trust list");
    const panel = screen.getByRole("group", { name: "Review before adding" });
    expect(panel.textContent).toContain("The signature is valid, but the signer is not confirmed.");
    expect(panel.textContent).toContain("Signed by List Signer · issued by Signer CA");
    expect(panel.textContent).toContain("SHA-256 D79B 8841 9E00 5F50…");
    expect(panel.textContent).toContain("Signer certificate valid until");
    const confirm = screen.getByRole("button", { name: "Add these roots" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(await axeViolations(container)).toEqual([]);

    addTrustRoot.mockResolvedValue({ added: [root("n.cer", "Provider N")], known: 0, withdrawn: 0, pinned: 0 });
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "I have checked where this file came from and want to use it anyway" }));
    });
    expect(confirm.disabled).toBe(false);
    await click("Add these roots");
    expect(addTrustRoot).toHaveBeenCalledWith({ path: "C:/lists/is.xml", expectedDigest: DIGEST, acceptUnverified: true });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reviews a list of lists that adds no roots instead of reporting nothing new", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    const lotl: TrustSource = { kind: "euListOfLists", territory: "EU", name: null };
    previewTrustRoots.mockResolvedValue(listPreview({ source: lotl, pinned: 31, signature: signature("unpinned") }));
    openDialog.mockResolvedValue("C:/lists/eu-lotl.xml");

    await click("Add certificate or trust list");
    const panel = screen.getByRole("group", { name: "Review before adding" });
    expect(panel.textContent).toContain("Trust list: EU list of trusted lists");
    expect(panel.textContent).toContain("Countries whose list signers it names: 31");
    expect(screen.getByRole("button", { name: "Save these list signers" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add these roots" })).toBeNull();
    expect(panel.textContent).not.toContain("New roots");
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("shows an unsigned list as unverifiable in origin and hides the signer", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    previewTrustRoots.mockResolvedValue(listPreview({ added: [root("u.cer", "Unsigned Root")], signature: signature("unsigned") }));
    openDialog.mockResolvedValue("C:/lists/unsigned.xml");

    await click("Add certificate or trust list");
    const panel = screen.getByRole("group", { name: "Review before adding" });
    expect(panel.textContent).toContain("This list is not signed, so its origin cannot be checked.");
    expect(panel.textContent).not.toContain("Signed by");
    expect((screen.getByRole("button", { name: "Add these roots" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reviews a single certificate that does not come from a certificate file", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    openDialog.mockResolvedValue("C:/lists/odd.xml");
    previewTrustRoots.mockResolvedValue(listPreview({ source: null, added: [root("c.cer", "Root C")], signature: null }));

    await click("Add certificate or trust list");
    expect(addTrustRoot).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Review before adding" })).toBeTruthy();
  });

  it("marks a signer the list of lists does not name as a strong warning", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    openDialog.mockResolvedValue("C:/lists/de.xml");
    previewTrustRoots.mockResolvedValue(listPreview({ added: [root("n.cer", "Provider N")], signature: signature("pinMismatch") }));

    await click("Add certificate or trust list");
    const warning = screen.getByText("The signature is valid, but the signer is not one the EU list of trusted lists names for this country.");
    expect(warning.className).toContain("text-destructive");
    expect((screen.getByRole("button", { name: "Add these roots" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the list and reports the error when removing everything fails", async () => {
    render(<TrustRootsSection onChanged={vi.fn()} />);
    await screen.findByText("Root A");
    clearTrustRoots.mockRejectedValue(new RpcCallError({ code: "INTERNAL", message: "disk full" }));

    await click("Remove all");
    await click("Remove all");
    expect(screen.getByText("Root B")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Remove all" })).toBeTruthy();
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["error"]);
  });
});
