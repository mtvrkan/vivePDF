# Present a PDF

> How to present a PDF full screen in vivePDF, from F5 to the pen and laser, black and white boards, speaker notes and the two-screen presenter view.

URL: https://vivepdf.com/en/docs/present/
Last updated: 2026-10-18

vivePDF turns any PDF into a full-screen slide show without a separate presentation program. While you present, you can draw on the page, use a laser pointer or spotlight, switch to a black or white board, and with a projector connected see your notes on your own screen only.

## Start a presentation

1. Open the PDF in the **Viewer**. The [Open and read a PDF](https://vivepdf.com/en/docs/open-and-read/) page explains how.
2. Press `F5` to start from the first page, or `Shift+F5` to start from the page you are on. `F11` (`⌃``⌘``F` on a Mac) enters and leaves presentation mode too.
3. Move between pages with the arrow keys, `Page Up` and `Page Down`. `G` opens the **Slide overview** with every slide; click one to jump there.
4. Press `Esc` to finish. Each `Esc` takes exactly one step back: first it puts the tool away, then it leaves the board, and last it ends the presentation.

The presentation toolbar appears when you move the pointer to the bottom edge of the screen.

## Drawing and pointing tools

Pick a tool from the toolbar or with a single key:

| Key | Tool |
|---|---|
| `L` | Laser pointer |
| `P` | Pen |
| `H` | Highlighter |
| `E` | Eraser |
| `S` | Spotlight |
| `M` | Magnifier |
| `U` | On-screen ruler |
| `Z` | Zoom to a dragged area |
| `V` | Select, move or delete drawings |

The **Shapes** menu on the toolbar holds **Line**, **Arrow**, **Rectangle**, **Ellipse** and **Measure length**, and **Text** lets you type on the page. For a selected drawing, `R` and `Shift+R` rotate it right and left, `Ctrl+D` duplicates it and `Del` deletes it. `Ctrl+Z` and `Ctrl+Y` undo and redo drawing.

The on-screen ruler shows real centimetres; drag it to move or turn it, and lines drawn along its edge come out straight.

Defaults for the pen colour and width, the laser colour and the spotlight size are in **Settings › Presentation**. Every presentation shortcut is listed on the [Keyboard shortcuts](https://vivepdf.com/en/docs/shortcuts/) page.

## Black and white boards

`B` or `.` turns the screen black and `W` turns it white. Use the empty screen to draw the audience's attention back to you, or draw on it like a whiteboard. A board has its own **Board tools** bar: select, pen, highlighter, shapes and eraser, colours that suit the board, size presets, undo and redo, **Clear board** and **Back to slides**. Each board keeps its own undo history.

## Notes, timer and clock

- `N` shows or hides the **Speaker notes** panel for the current page. Notes are kept page by page and shared with presenter view.
- `T` shows or hides the timer, and `C` the clock.
- If a page contains code, `K` opens the detected code blocks and moves between them.

## Presenter view (two screens)

With a projector or second screen connected, press `Alt+F5` or click **Presenter view** on the Viewer toolbar; `Alt+Shift+F5` starts from the page you are on. The projector shows only the slide. Your screen shows the **Current page**, a large **Next page** preview, the **Elapsed** time, the **Clock** and your **Speaker notes**.

- The preview's arrows let you look further ahead without changing the projector; clicking a preview jumps the presentation there.
- The pen, laser, spotlight and boards appear on the projector too.
- **Swap screens** trades the roles of the two screens, and **End presentation** closes it.
- Notes are saved in the app's data folder on this computer; the PDF itself is not changed.

> **If only one screen is visible**
>
> When the projector mirrors your screen, vivePDF shows **Only one screen is visible**. On Windows, press `Windows+P`, choose **Extend**, then click **Try again**. You can also carry on with **Present on this screen** or **Rehearse in a window**.

If the document has unsaved changes, the projector shows the file as it is saved on disk, so vivePDF first asks you to choose between **Save and present** and **Present anyway**.

## Insert items while presenting

The **Insert** (+) button on the presentation toolbar and in the presenter console offers **Add formula**, **Add shape**, **Add function graph**, **Add molecule**, **Add table**, **Add chart**, **Add flowchart**, **Add diagram (Mermaid)**, **Add question** and **Add answer key**. Prepare the item, then click the page to place it; `Esc` cancels. You can move and resize a placed item like a drawing and double-click it to edit it again. The Insert menu works on the black and white boards too.

## Keep or discard drawings

Presentation drawings and inserted items are temporary by default. When you leave the presentation, vivePDF asks **Keep the presentation drawings?**:

- **Save to the PDF** writes the drawings into the PDF as annotations; board drawings are added as new pages at the end.
- **Discard drawings** removes them all.
- **Decide later** keeps them as an unsaved change; they are written into the PDF when you save the document.

To keep permanent notes every time, set **Drawings** to **Permanent notes** in **Settings › Presentation**. For the rest of the settings, see [Settings and privacy](https://vivepdf.com/en/docs/settings-privacy/).
