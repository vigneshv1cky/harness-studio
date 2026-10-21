# Undo

Undo for the agent's file changes, and Rewind for the conversation, like Claude Code's rewind: under each turn that changed files, **Undo file changes** puts those files back the way they were before that turn, and **Rewind** restores the code, the conversation or both to before one of your messages.

## How it works

- Just before the agent first changes a file in a turn, through its `write` or `edit` tool (or `str_replace_editor` where that is mounted), a copy of the file is kept. A file the agent is about to create is noted as new. Later changes to the same file in the same turn keep nothing more, because the copy already holds the state before the turn.
- The row under a turn names how many files it would put back. Clicking it lists the files and asks to confirm; files that were new are marked as about to be removed.
- Undo from a turn restores every file changed in that turn **and every later turn** to its state before that turn, removes files that did not exist then, and forgets those turns' copies. Undoing an earlier turn therefore also undoes the turns after it.
- The agent is told which files were restored or removed, so it reads them again before relying on what it remembers.
- A copy is kept as the call runs, after every check and approval: a change you approved on an "ask" card is covered, and a call refused by the sandbox, a hook, a rule or you keeps nothing.
- A helper agent's changes count towards the turn of the conversation you are talking to, so Undo under that turn puts them back too.
- Files are put back by writing beside them and renaming over them, so a link put in a file's place since the copy was kept is replaced, never written through.

## Rewind

As in Claude Code, you can rewind to any message you sent that started a turn: with the rewind button in the small row under the message (beside Copy), or by pressing **Esc twice in an empty message box**, which lists those messages newest last (↑↓ to choose, Enter to pick, Esc to go back or close). Either way you get Claude Code's choices:

- **Restore code and conversation:** puts the files back, then restores the conversation.
- **Restore conversation:** this chat goes back to before that message: the turns from there on disappear from it and the message's text is put back in the message box to edit and resend. Files stay as they are now.
- **Restore code:** puts back the files the agent changed from that message on, as Undo from that turn does. The conversation stays.
- **Cancel.**

The code choices appear only when the agent changed files with its file tools from that message on, and not while it is still working on that message. If some files cannot be put back, it says which, and for the combined choice lets you restore the conversation anyway.

How the conversation is restored: in place, in the same chat. Harness keeps every session's log append-only, because everything the model sees must be rebuilt from it, so a rewind deletes nothing. It appends one entry that replaces everything from that message on in what the model sees (the same mechanism compaction uses), and the chat hides those turns; anything still queued is dropped. The rewound turns stay in the log and in the chat's Trajectory view. Workspace instructions, the skills list and the runtime context the model had seen in the rewound turns are given to it again on the next message. A chat that was compacted after that message, with the summary covering conversation from both before and after it, cannot be rewound to that message; Rewind says so.

Only the message's text comes back, not its attached images or files.

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
| Host | `index.js` | Keeps a copy before each allowed file change, and serves `list`, `restore` and `messages` (the messages that can be rewound to, read from the session log) to the client through Harness's authenticated Remote channel (`harnessStudioUndo/call`) |
| Host | `store.js` | The copies on disk, and restoring them |
| Client | `client.js` | The Undo row under each finished turn (`conversation.chat.turnTail`), with its confirmation and result; the rewind button on each message that started a turn (`conversation.chat.user-actions`) and the Esc-twice message list above the composer (`conversation.input.dock`), with Claude Code's restore choices; the conversation is rewound by Harness's session rewind |

## Tests

```sh
node --test plugins/undo/test/*.test.mjs
```

They cover which tool calls are copied, keeping only the first copy per turn, restoring from a turn and from an earlier one, removing new files, large files, refusing a malformed session id, and the plugin end to end against a stand-in Harness: a refused call keeps nothing, an allowed one does, and Undo tells the agent.
