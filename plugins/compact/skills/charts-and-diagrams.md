# Charts, icons and diagrams

Make charts, icons and diagrams as files the user can open, edit and reuse, without installing anything.

## Choose the format

| The user wants | Make |
|---|---|
| A chart inside a PowerPoint deck or Excel workbook | A native chart through the office skills (python-pptx in decks, XlsxWriter or openpyxl in workbooks). It stays editable in PowerPoint and Excel and carries its data. Do not paste a picture of a chart into a deck. |
| A standalone chart, an icon or a diagram | An SVG file, written by code from the data. |
| A chart or diagram inside a web page | Inline SVG in the page, styled with the page's own CSS variables. |
| A bitmap (PNG or JPG) specifically | Draw it with the bundled Python's Pillow at twice the target size, then downscale for smooth edges. The bundled office converter does not read SVG, and there is no plotting library, so do not try either. |

Load the bundled dependencies with `load_workspace_dependencies` when a script needs Python; numpy and pandas are available for the numbers.

## Charts

- Compute the layout in the script: plot area inside fixed margins, linear scales from the data range, and 4 to 6 rounded axis ticks (multiples of 1, 2 or 5 times a power of ten) that include zero for bar charts.
- Label everything a reader needs: a title stating what is measured, axis labels with units, tick labels, and a legend only when there is more than one series. Put values on bars when there are few of them.
- Use the project's colours when it has a palette; otherwise use one accent for a single series and distinct, colour-blind-safe hues for several. Keep text dark on light, at least 12 px.
- Use a `viewBox` with explicit `width` and `height`, real `<text>` elements (not outlined paths) with a system font stack, and `text-anchor` for alignment. Round coordinates to one decimal place.
- Check the numbers: every bar height, point and label must match the source data. Recompute rather than eyeball.

## Icons

- One SVG per icon on a 24 × 24 `viewBox`, drawn with strokes: `fill="none"`, `stroke="currentColor"`, a stroke width of 1.5 or 2, round caps and joins, and about 2 units of padding.
- Keep a set consistent: the same stroke width, corner radius, padding and level of detail across every icon. No text inside icons.
- Name files for what they show (`icons/calendar.svg`). For an app, also offer the icons as inline components in the project's framework if that is how it uses icons.

## Diagrams

- Flowcharts, architecture and sequence diagrams are SVG boxes and arrows laid out on a grid computed in the script: equal box sizes per row, at least 24 px between boxes, arrows drawn with a `marker-end` arrowhead and routed with straight or right-angled segments that do not cross boxes.
- Every box has a short label; every arrow that is not obvious has a label beside it. Read top to bottom or left to right.
- When the user wants an editable source as well, also write the same diagram as Mermaid text in a Markdown file; it is not rendered here, so the SVG is the picture.

## Show and check

Open each SVG in the preview pane to look at it, or for a web page, check it in the Browser pane with `browser_screenshot`. Fix overlapping labels, clipped text and unreadable contrast, then hand the files over with `present`.
