const VIEWER_SCRIPT = "/viewer/vivepdf.js";

const demo = document.getElementById("wvDemo");
const start = document.getElementById("wvStart");
const copyButton = document.getElementById("wvCopy");
const code = document.getElementById("wvCode");

const siteTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function loadViewerScript() {
  if (document.querySelector(`script[src="${VIEWER_SCRIPT}"]`)) return;
  const script = document.createElement("script");
  script.src = VIEWER_SCRIPT;
  document.head.append(script);
}

if (demo && start) {
  start.addEventListener("click", () => {
    loadViewerScript();
    const viewer = document.createElement("vive-pdf");
    viewer.setAttribute("src", demo.dataset.sample ?? "");
    viewer.setAttribute("lang", demo.dataset.lang ?? "en");
    viewer.setAttribute("theme", siteTheme());
    viewer.setAttribute("annotate", "");
    viewer.setAttribute("aria-label", demo.dataset.label ?? "");
    viewer.tabIndex = -1;
    demo.replaceChildren(viewer);
    demo.classList.add("on");
    viewer.focus();
    new MutationObserver(() => viewer.setAttribute("theme", siteTheme())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });
}

if (copyButton && code) {
  const label = copyButton.querySelector("span");
  const idle = label?.textContent ?? "";
  let reset = 0;
  copyButton.addEventListener("click", async () => {
    if (!label) return;
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      label.textContent = copyButton.dataset.copied ?? "";
    } catch {
      label.textContent = copyButton.dataset.failed ?? "";
    }
    window.clearTimeout(reset);
    reset = window.setTimeout(() => (label.textContent = idle), 1800);
  });
}
