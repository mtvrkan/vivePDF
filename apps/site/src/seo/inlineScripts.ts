import { createHash } from "node:crypto";

export const INLINE_SCRIPTS = {
  theme: `(function(){var d=document.documentElement,t=new URLSearchParams(location.search).get("theme");if(t!=="dark"&&t!=="light"){try{t=localStorage.getItem("vp-theme")}catch(e){}}if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(t==="dark")document.querySelector('meta[name="theme-color"]').content="#060B15"})();`,
  motion: `(function(){var s=new URLSearchParams(location.search).has("still")||matchMedia("(prefers-reduced-motion: reduce)").matches;document.documentElement.classList.add(s?"still":"motion")})();`,
  keys: `(function(){var k;try{k=localStorage.getItem("vp-keys")}catch(e){}if(k!=="mac"&&k!=="win")k=/mac/i.test(navigator.platform)?"mac":"win";document.documentElement.dataset.keys=k})();`,
  notFoundSwap: `(function(){if(!/^\\/en(\\/|$)/.test(location.pathname))return;var d=document.documentElement;d.classList.add("nf-swap");fetch("/en/404/").then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(h){document.open();document.write(h);document.close()}).catch(function(){d.classList.remove("nf-swap")})})();`,
} as const;

export function inlineScriptHashes(): string[] {
  return Object.values(INLINE_SCRIPTS).map((code) => `sha256-${createHash("sha256").update(code).digest("base64")}`);
}
