import { afterEach, describe, expect, it } from "vitest";
import { hasOpenModal, hasTextSelectionOutsidePages, isActivatableTarget, isInsideCompositeWidget } from "./viewerKeyTarget";

function mount(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host;
}

describe("viewer key targets", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("treats buttons, links and menu items as activatable but not plain regions", () => {
    const host = mount('<button id="b">x</button><div id="m" role="menuitem">y</div><div id="r" role="region">z</div>');
    expect(isActivatableTarget(host.querySelector("#b"))).toBe(true);
    expect(isActivatableTarget(host.querySelector("#m"))).toBe(true);
    expect(isActivatableTarget(host.querySelector("#r"))).toBe(false);
    expect(isActivatableTarget(null)).toBe(false);
  });

  it("finds keys typed inside tab lists, menus and radio groups", () => {
    const host = mount('<div role="tablist"><div id="tab" role="tab">a</div></div><div role="radiogroup"><span id="radio">b</span></div><div id="page" role="region">c</div>');
    expect(isInsideCompositeWidget(host.querySelector("#tab"))).toBe(true);
    expect(isInsideCompositeWidget(host.querySelector("#radio"))).toBe(true);
    expect(isInsideCompositeWidget(host.querySelector("#page"))).toBe(false);
  });

  it("notices an open modal dialog", () => {
    expect(hasOpenModal()).toBe(false);
    mount('<div role="dialog" aria-modal="true">x</div>');
    expect(hasOpenModal()).toBe(true);
  });

  it("tells text selected in a side panel apart from the page view", () => {
    const host = mount('<aside id="panel">Panel text</aside><div data-pan-scroller><span id="page">Page text</span></div>');
    const selection = window.getSelection() as Selection;
    expect(hasTextSelectionOutsidePages(selection)).toBe(false);
    selection.selectAllChildren(host.querySelector("#panel") as Element);
    expect(hasTextSelectionOutsidePages(selection)).toBe(true);
    selection.selectAllChildren(host.querySelector("#page") as Element);
    expect(hasTextSelectionOutsidePages(selection)).toBe(false);
  });
});
