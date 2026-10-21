import { createHash } from "node:crypto";

export const INLINE_SCRIPTS = {
  theme: `(function(){var d=document.documentElement,t=new URLSearchParams(location.search).get("theme");if(t!=="dark"&&t!=="light"){try{t=localStorage.getItem("vp-theme")}catch(e){}}if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(t==="dark")document.querySelector('meta[name="theme-color"]').content="#0F1115"})();`,
  motion: `(function(){var d=document.documentElement,q=new URLSearchParams(location.search),s=q.has("still")||matchMedia("(prefers-reduced-motion: reduce)").matches,n=navigator,c=n.hardwareConcurrency||8,m=n.deviceMemory||8,l=q.has("lite");d.classList.add(s?"still":"motion");if(!l&&!q.has("full"))l=c<=2||m<=2||(c<=4&&m<=4);if(l)d.classList.add("lite")})();`,
  keys: `(function(){var k;try{k=localStorage.getItem("vp-keys")}catch(e){}if(k!=="mac"&&k!=="win")k=/mac/i.test(navigator.platform)?"mac":"win";document.documentElement.dataset.keys=k})();`,
  notFoundSwap: `(function(){if(!/^\\/en(\\/|$)/.test(location.pathname))return;var d=document.documentElement;d.classList.add("nf-swap");fetch("/en/404/").then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(h){document.open();document.write(h);document.close()}).catch(function(){d.classList.remove("nf-swap")})})();`,
  langRedirect: `(function(){var n=navigator,s,r=document.referrer,l,i;try{s=localStorage.getItem("vp-lang")}catch(e){}if(s||/bot|crawl|spider|slurp|lighthouse|headless|google|bing|yandex|baidu|duckduck|facebookexternalhit|preview|inspection/i.test(n.userAgent))return;if(r&&r.indexOf(location.origin+"/")===0)return;l=n.languages&&n.languages.length?n.languages:[n.language||""];for(i=0;i<l.length;i++)if(/^tr(-|$)/i.test(l[i]))return;location.replace("/en/"+location.search)})();`,
} as const;

export function inlineScriptHashes(): string[] {
  return Object.values(INLINE_SCRIPTS).map((code) => `sha256-${createHash("sha256").update(code).digest("base64")}`);
}
