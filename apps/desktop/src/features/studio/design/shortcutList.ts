export type ShortcutItem = { keys: string; labelKey: string };
export type ShortcutGroup = { id: string; items: ShortcutItem[] };

const item = (keys: string, label: string): ShortcutItem => ({ keys, labelKey: `studio.shortcuts.items.${label}` });

export const STUDIO_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "file",
    items: [
      item("Ctrl S  /  Ctrl Shift S", "save"),
      item("Ctrl O", "open"),
      item("Ctrl E", "export"),
      item("?  /  F1", "help"),
    ],
  },
  {
    id: "edit",
    items: [
      item("Ctrl Z  /  Ctrl Y  ·  Ctrl Shift Z", "undoRedo"),
      item("Ctrl C  /  Ctrl X  /  Ctrl V", "clipboard"),
      item("Ctrl Shift V", "pasteInPlace"),
      item("Ctrl D", "duplicate"),
      item("Delete  /  Backspace", "delete"),
      item("Ctrl A", "selectAll"),
      item("Esc", "escape"),
    ],
  },
  {
    id: "arrange",
    items: [
      item("← → ↑ ↓  ·  Shift", "nudge"),
      item("Ctrl G  /  Ctrl Shift G", "group"),
      item("Ctrl ↑  /  Ctrl ↓", "forwardBackward"),
      item("Ctrl Shift ↑  /  Ctrl Shift ↓", "frontBack"),
      item("Ctrl Shift L", "lock"),
      item("Ctrl Shift H", "hide"),
    ],
  },
  {
    id: "insert",
    items: [
      item("T", "text"),
      item("R", "rectangle"),
      item("O", "ellipse"),
      item("L", "line"),
    ],
  },
  {
    id: "text",
    items: [
      item("Enter  /  F2", "editText"),
      item("Ctrl B  /  Ctrl I  /  Ctrl U", "textStyle"),
      item("Ctrl Shift >  /  Ctrl Shift <", "fontSize"),
    ],
  },
  {
    id: "view",
    items: [
      item("Ctrl +  /  Ctrl −  ·  Ctrl Wheel", "zoom"),
      item("Ctrl 0  /  Shift 1", "fit"),
      item("Ctrl 1", "actualSize"),
      item("Shift 2", "zoomSelection"),
      item("Space + Drag  ·  Middle Drag", "pan"),
      item("PgUp  /  PgDn", "pages"),
      item("Shift R  /  Ctrl R", "rulers"),
      item("Shift G", "guides"),
      item("Shift M", "margins"),
    ],
  },
  {
    id: "mouse",
    items: [
      item("Shift Click", "addToSelection"),
      item("Shift Drag", "axisLock"),
      item("Ctrl Drag", "noSnap"),
      item("Alt Drag", "duplicateDrag"),
      item("Shift Resize", "keepRatio"),
      item("Alt Resize", "fromCentre"),
      item("Shift Rotate", "rotateStep"),
    ],
  },
];

export const DOCUMENT_SHORTCUTS: ShortcutItem[] = [
  item("Ctrl S  /  Ctrl Shift S", "save"),
  item("Ctrl E", "export"),
  item("Ctrl Z  /  Ctrl Y", "undoRedo"),
  item("Ctrl B  /  Ctrl I  /  Ctrl U", "textStyle"),
  item("Ctrl Alt 1  /  2  /  3", "headings"),
  item("Ctrl Shift 8  /  Ctrl Shift 7", "lists"),
  item("Shift Enter", "lineBreak"),
];
