# Design board

Draft screens before building them: one self-contained HTML file that shows each screen side by side at real phone, tablet and desktop widths, so the user can compare directions and nudge the design before any app code changes.

## Before drafting

1. Read the project's real design values first: colour and spacing variables, font families and sizes, radii and shadows, from its stylesheets, theme or token files and the components the screen will reuse. Copy exact values; do not round them or invent a palette. In a project with no styles yet, choose a small set and state it.
2. Use real content, including the longest strings the app will show (long names, long headlines, many items). Long content is what breaks layouts.

## Write the board

Save it as `designs/<topic>.board.html` in the workspace (create the folder). The file is plain HTML in this order:

1. `<!doctype html>`, then `<head>` with `<meta charset="utf-8">` and a `<title>` naming the board (it shows in the board's toolbar).
2. One `<template data-shared>` with what every screen shares: a `<style>` block of the project's tokens as CSS variables, base element styles, and font imports if the project uses web fonts.
3. One `<template data-screen="Name">` per screen or variant, containing that screen's `<style>` and markup only (no `html`, `head` or `body` tags). Use the project's class names and structure where they exist, so the draft maps onto the code. Media queries inside a screen respond to the artboard's width.
   - `data-widths="375,768,1440"` chooses the artboards (this is the default). Use other widths when the project's breakpoints differ.
   - `data-height="900"` fixes the artboard height; leave it out to grow each artboard to the screen's full length.
   - For alternatives, add more screens named for the choice they show, for example "Home: large photo" and "Home: compact list".
4. The board runtime below, copied exactly as the last thing in `<body>`.

Each artboard is an isolated frame, so screens cannot affect one another, and the file needs no server, build step or network: it opens by double-click in any browser.

## Show and check it

- In Harness Studio the Design pane, beside the chat, shows the board as soon as it is saved in `designs/` and reloads it after every edit, keeping the user's zoom. Its list holds every board in the folder, and clicking a screen's label (or an artboard with Pick on) puts a reference such as `[designs/habit-settings.board.html, Home: compact list at 375 px]` in the user's message: edit that screen in that board. Keep the board runtime intact, or the pane cannot tell which screen was clicked.
- Check it once before handing it over: serve the folder on a free local port (for example `python3 -m http.server --bind 127.0.0.1 <port>`), open the board in the Browser pane with `browser_open`, and take a `browser_screenshot`; the board opens fitted to the pane's width, so scroll down for the rest. Fix overflow, overlap, clipped text and anything that ignores the project's values in one round of edits, check once more, and stop. Stop the server afterwards.
- Use only the Browser pane for this check. If `browser_screenshot` reports that the window is hidden or covered, do not switch to another browser, install one, or try to bring the window forward with computer use: check the structure with `browser_read` if useful, hand the board over, and say it was not checked visually.
- Hand the file over with `present`, naming each screen and the choice each variant shows, and say it is open in the Design pane, where clicking a screen's name references it in a message. Outside Harness Studio the board opens by double-click in any browser. It opens fitted to the window's width; scroll or drag anywhere pans, Ctrl or ⌘ with scroll zooms, Fit returns to the width fit, and **Use screens** lets the user click and scroll inside the screens. Screens show at full length, so do not rely on a screen scrolling inside its artboard.
- When the user picks a direction or asks for changes, edit the same board file, then build the chosen design in the real code with the same values.

## Board runtime

Copy everything between the two marker lines, without changes:

----- board runtime start -----
{{BOARD_RUNTIME}}
----- board runtime end -----
