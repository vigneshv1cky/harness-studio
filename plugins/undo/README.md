# Undo

Undo for the agent's file changes, like Claude Code's rewind: under each turn that changed files, **Undo file changes** puts those files back the way they were before that turn.

## How it works

- Just before the agent first changes a file in a turn, through its `write` or `edit` tool (or `str_replace_editor` where that is mounted), a copy of the file is kept. A file the agent is about to create is noted as new. Later changes to the same file in the same turn keep nothing more, because the copy already holds the state before the turn.
- The row under a turn names how many files it would put back. Clicking it lists the files and asks to confirm; files that were new are marked as about to be removed.
- Undo from a turn restores every file changed in that turn **and every later turn** to its state before that turn, removes files that did not exist then, and forgets those turns' copies. Undoing an earlier turn therefore also undoes the turns after it.
- The agent is told which files were restored or removed, so it reads them again before relying on what it remembers.
- A copy is kept as the call runs, after every check and approval: a change you approved on an "ask" card is covered, and a call refused by the sandbox, a hook, a rule or you keeps nothing.
- A helper agent's changes count towards the turn of the conversation you are talking to, so Undo under that turn puts them back too.
- Files are put back by writing beside them and renaming over them, so a link put in a file's place since the copy was kept is replaced, never written through.

## What is not covered

- **Shell commands.** A command can change any file without saying which, so its changes are not copied, as in Claude Code. Use git for those.
- **Files larger than 10 MB** and paths that are not regular files are noted but not copied; Undo reports them as not restorable.
- **Your own edits** to those files after the turn are overwritten by Undo, as the confirmation says.

## Where copies live

```
<harness home>/harness-studio/undo/<session id>/
  manifest.json    which files each turn changed, and whether they existed
  blobs/<sha256>   the earlier contents, stored once however many turns share them
```

In the Harness Studio app the Harness home is `~/.harness-studio`. Copies are plain files and can be deleted at any time; Undo then has nothing to restore for those turns.

## Parts

| Half | File | Role |
|---|---|---|
| Host | `index.js` | Keeps a copy before each allowed file change, and serves `list` and `restore` to the client through Harness's authenticated Remote channel (`harnessStudioUndo/call`) |
| Host | `store.js` | The copies on disk, and restoring them |
| Client | `client.js` | The Undo row under each finished turn (`conversation.chat.turnTail`), with its confirmation and result |

## Tests

```sh
node --test plugins/undo/test/*.test.mjs
```

They cover which tool calls are copied, keeping only the first copy per turn, restoring from a turn and from an earlier one, removing new files, large files, refusing a malformed session id, and the plugin end to end against a stand-in Harness: a refused call keeps nothing, an allowed one does, and Undo tells the agent.
