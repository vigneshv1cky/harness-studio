# Editor

A code editor in the right panel, built on [CodeMirror](https://codemirror.net). Files you open in the right panel's Files tab open in this editor, ready to edit. A file opened from a link in the conversation shows in the file preview; press **Edit** in its toolbar to open it in an Editor tab.

## What it does

- **Editing** with syntax colours for JavaScript and TypeScript (including JSX), JSON, CSS, HTML, Markdown, Python and YAML, line numbers, search and replace (⌘F), multiple cursors, bracket matching, code folding and auto-indent. Other files open as plain text.
- **Saving** with ⌘S / Ctrl+S or the Save button. The tab title shows a dot while there are unsaved changes.
- **Following the agent's changes.** The tab checks the file on disk every 1.5 seconds:
  - with no unsaved edits, it applies the change in place. Only the changed span is replaced, so your cursor, selection, scroll position and undo history are kept; the agent's change itself is not added to your undo history.
  - with unsaved edits, it shows a bar asking whether to **Use the disk version** (discarding your edits) or **Keep mine** (your next save replaces the disk version).
- **Never overwriting unseen changes.** A save is refused if the file changed on disk since the editor last read it; the same bar appears instead. The agent's own edits are protected the same way in reverse: it must re-read a file you changed before editing it.
- **Keeping the file as it was.** Line breaks stay as the file has them (CRLF, CR or LF, taken from its first line break, and new lines use the same), and a UTF-8 byte order mark is kept.
- Light and dark follow the app's theme.

## Limits

- Files must be inside one of your workspace folders, checked on the real path, so a link pointing outside a workspace is refused. Files over 2 MB, binary files and files that are not UTF-8 text open in the preview only, so their bytes are never rewritten.
- There is no way to create a new file from the editor; open existing files from the right panel's Files tab, or from a file link in the conversation and then Edit.
- Closing an Editor tab with unsaved changes discards them; closing a file in the Files tab asks first.
- Edits you save are yours, not the agent's: Undo for the agent's turns does not cover them.

## Parts

| Half | File | Role |
|---|---|---|
| Host | `index.js` | Opens, checks and saves files for the client, through Harness's authenticated Remote channel (`harnessStudioEditor/call`); saves are written to a new file beside it, under a random name created exclusively (so a link planted there is not followed), and renamed over it, keeping its permissions |
| Client | `client.js` | Built file: the file editor, which the Files tab (Dev Preview plugin) shows for every file it opens, handed over on `window.__harnessStudio.FileEditor`; with an optional rendered view that shows the buffer's current text in place of the editor while keeping it open underneath (the Files tab uses it for Markdown); the Editor tab type (addresses `dsh-resource://harness-studio-editor/open?path=…`, since the right panel opens only `dsh-resource://` addresses), its title, and the Edit button in the file preview |
| Client source | `src/editor.client.js` | The client code before bundling |
| Vendor | `vendor/codemirror.iife.js` | CodeMirror 6 and its language packages bundled into one minified file (see `vendor/PACKAGES.txt`; MIT, `vendor/LICENSE`). `client.js` carries it, but runs it only when an Editor tab first opens, so starting the app without editing a file costs no editor start-up (about 8 ms instead of 35 to load the plugin) |

`client.js` is generated: after changing `src/editor.client.js` or the vendor bundle, run

```sh
node plugins/editor/build.mjs
```

The vendor bundle was built with esbuild from `vendor/codemirror-entry.js` and the package versions in `vendor/PACKAGES.txt`.

## Tests

```sh
node --test plugins/editor/test/*.test.mjs
```

They cover opening and saving, keeping file permissions, refusing a save over a changed file, refusing files outside the workspace, through links, directories, binary files, files over 2 MB and files that are not UTF-8, keeping CRLF and CR line breaks and a byte order mark, and not writing through a link planted under a temporary name. `client.test.mjs` runs the client's text helpers from `src/editor.client.js` with the bundled CodeMirror: detecting the line separator, giving back CRLF, CR and mixed files exactly after edits, and applying a change on disk as one small change.
