export type Lightbox = { place: (active: boolean, label: string) => void; show: () => void; close: () => void; dispose: () => void };

export function createLightbox(root: ShadowRoot, frame: HTMLElement, onClose: () => void): Lightbox {
  let dialog: HTMLDialogElement | null = null;
  let active = false;
  const ensureDialog = () => {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "vp-dialog";
    dialog.tabIndex = -1;
    dialog.addEventListener("close", onClose);
    root.append(dialog);
    return dialog;
  };
  return {
    place(nextActive, label) {
      active = nextActive;
      if (active) {
        const target = ensureDialog();
        target.setAttribute("aria-label", label);
        if (frame.parentNode !== target) target.append(frame);
      } else {
        if (dialog?.open) dialog.close();
        if (frame.parentNode !== root) root.append(frame);
      }
    },
    show() {
      if (!active || !dialog || dialog.open) return;
      dialog.showModal();
      dialog.focus();
    },
    close() {
      if (dialog?.open) dialog.close();
    },
    dispose() {
      dialog?.removeEventListener("close", onClose);
      dialog?.remove();
      dialog = null;
    },
  };
}
