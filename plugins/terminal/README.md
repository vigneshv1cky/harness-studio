# Terminal

A real terminal for the agent. Harness's `bash` tool is line-based: a command goes in and its text output comes back, so full-screen and interactive programs (vim, nano, less, an interactive `git rebase`, installers that ask questions, REPLs) hang or fail there. This plugin runs such a program in a real pseudo-terminal, keeps its screen in a terminal emulator, and lets the agent read that screen as text and press keys.

## Tools

| Tool | Does |
|---|---|
| `terminal_start` | Runs a command line in a new terminal (default 120×32, up to 300×100) in the session's folder, and returns the screen once it settles |
| `terminal_send` | Types text, then presses keys, and returns the screen once it settles |
| `terminal_screen` | Returns the current screen, optionally after waiting for it to settle |
| `terminal_stop` | Ends the terminal and the program in it, returning its last screen |
| `terminal_list` | Lists the session's terminals |

Keys are named: any single character as itself, `Enter`, `Tab`, `Shift-Tab`, `Escape`, `Backspace`, `Space`, `Delete`, `Insert`, the arrows, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F12`, `Ctrl-A`…`Ctrl-Z` and `Alt-<key>`. Arrow keys follow the program's cursor mode, as a real terminal does.

A screen comes back as a header (id, command, size, running or exit status), the cursor position, and the visible rows with trailing spaces and empty rows removed. "Settled" means no output for 300 ms after the last input, up to the wait given (1.5 s by default, at most 15 s), or the program exiting.

## Limits and safety

- Programs run under the session's sandbox, exactly like `bash`: the same file-write limits and the same network setting. A terminal started under one sandbox setting is closed within 2 seconds of the session's setting changing, whether or not the agent is using it, and must be started again; the agent is told why when it next uses that terminal.
- A session and its helper agents together can have 4 programs running, counting ones still starting. A terminal whose program exited keeps its last screen but holds no slot; each agent keeps at most 4 terminals, and the oldest exited one is dropped to make room. A terminal still starting when its session ends is ended as soon as it starts.
- Ending a terminal (the agent stopping it, the session ending, a sandbox change, or 30 minutes unused) ends the program's whole process group: SIGHUP and SIGTERM, then SIGKILL after 1 second, and a check that the group is gone; `terminal_stop` reports an error if it is not. A looping shell is ended too, which Harness's own teardown alone does not manage, since the shell keeps starting new children.
- The Session pane's Background tasks card lists a session's terminals (command, start time, running or exited) and can stop one, through the `harnessStudioTerminal/call` Remote method on Harness's authenticated channel. A terminal the user stops ends like one the agent stops, and the agent is told the user stopped it when it next uses that id.
- Programs that inspect other processes, such as `top` and `htop`, may be refused by the sandbox.
- The screen is plain text: colours and styles are not shown. Scrollback beyond the visible screen is not returned.
- Changes made through a terminal (for example saving in vim) are not covered by Undo, like changes made by `bash`.

## How it works

`terminal_start` builds `bash -c <command>`, confines it through the sandbox provider with the session's resolved policy, and starts it with Harness's subprocess service as a real terminal (`TERM=xterm-256color`). Output feeds a headless xterm.js emulator (`@xterm/headless`, which Harness's own terminal backend already ships); the screen is read from its buffer.

## Tests

```sh
node --test plugins/terminal/test/*.test.mjs
```

They cover key encoding (including application cursor mode), reading the emulator's screen, starting a confined program, typing into it, exits, the limit (exited terminals freeing their slot, sharing it with helper agents, starts made at the same time), closing on a sandbox change both when the terminal is next used and from the 2-second check, ending a terminal whose session ended while it started, stopping and listing. They use the real emulator and a stand-in terminal process; two tests run a real looping `bash` in its own process group and check that stopping it, and the idle close, leave no process behind.
