import { VIEWER_CONTROLS, VIEWER_DEFAULTS, viewerAttributes, viewerSnippet, type ViewerControl, type ViewerOptions } from "../docs/viewerSnippet";

type PreviewElement = HTMLElement & { show(): void };

const playground = document.querySelector<HTMLElement>("[data-viewer-playground]");
if (playground) {
  const form = playground.querySelector<HTMLFormElement>("[data-viewer-form]") as HTMLFormElement;
  const code = playground.querySelector<HTMLElement>("[data-viewer-code]") as HTMLElement;
  const copyButton = playground.querySelector<HTMLButtonElement>("[data-viewer-copy]") as HTMLButtonElement;
  const copyLabel = copyButton.querySelector<HTMLElement>("[data-viewer-copy-label]") as HTMLElement;
  const openButton = playground.querySelector<HTMLButtonElement>("[data-viewer-open]") as HTMLButtonElement;
  const preview = playground.querySelector<PreviewElement>("[data-viewer-preview]") as PreviewElement;
  const copy = { src: playground.dataset.src ?? "", open: playground.dataset.open ?? "" };
  const managed = ["mode", "page", "zoom", "theme", "lang", "accent", ...VIEWER_CONTROLS];

  const read = (): ViewerOptions => {
    const data = new FormData(form);
    const shown = data.getAll("controls").map(String);
    const page = Math.min(5, Math.max(1, Math.floor(Number(data.get("page")) || 1)));
    return {
      mode: String(data.get("mode") ?? VIEWER_DEFAULTS.mode) as ViewerOptions["mode"],
      theme: String(data.get("theme") ?? VIEWER_DEFAULTS.theme) as ViewerOptions["theme"],
      lang: String(data.get("lang") ?? "") as ViewerOptions["lang"],
      zoom: String(data.get("zoom") ?? VIEWER_DEFAULTS.zoom) as ViewerOptions["zoom"],
      page,
      accent: String(data.get("accent") ?? ""),
      hidden: VIEWER_CONTROLS.filter((control: ViewerControl) => !shown.includes(control)),
    };
  };

  const apply = () => {
    const options = read();
    const attributes = new Map(viewerAttributes(options));
    for (const name of managed) {
      const value = attributes.get(name);
      if (value === undefined) preview.removeAttribute(name);
      else if (preview.getAttribute(name) !== value) preview.setAttribute(name, value);
    }
    openButton.hidden = options.mode !== "lightbox";
    code.textContent = viewerSnippet(options, copy);
  };

  let resetLabel = 0;
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
    } catch {
      return;
    }
    copyLabel.textContent = playground.dataset.copied ?? "";
    window.clearTimeout(resetLabel);
    resetLabel = window.setTimeout(() => {
      copyLabel.textContent = playground.dataset.copy ?? "";
    }, 2000);
  });
  openButton.addEventListener("click", () => preview.show());
  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
  form.addEventListener("submit", (event) => event.preventDefault());
  apply();
}
