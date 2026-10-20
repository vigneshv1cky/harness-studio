# Watch

Cheap checks for Harness Studio that wake the agent only when something changes.

A scheduled check costs a full model turn every time it runs, even when nothing happened. A watch runs on your computer without the model, compares each result with the last one the agent knew, and sends the agent a short notice only when the result changes or a condition becomes true.

Watch is one of the plugins built into the Harness Studio app and is always on.

## What can be watched

| Kind | What runs | Result compared |
| --- | --- | --- |
| `command` | A shell command every `interval_seconds` (at least 5, default 30), through Harness's own command runner under the session's sandbox mode and network policy. The next run starts after the previous one ends; each run has a time limit (default 30 s, at most 120 s) and keeps 64 KB of output. | Exit code and output (standard output, then standard error) |
| `port` | A connection attempt to a port on this computer (`localhost`, `127.0.0.1` or `::1`) every `interval_seconds` (default 10). | Up or down |
| `files` | The operating system's file events for files or folders inside the session folder (folders include everything under them except `.git` and `node_modules`), grouped over a 2-second quiet window. Paths outside the session folder (links resolved), and paths the session's sandbox keeps from being read, are refused, since watching runs outside the sandbox. On Linux, folders are watched one by one, at most 2,000 per watch, and new folders are added as they appear. | Which paths changed (at most 200 per batch, counted after ignored and unmatched paths are dropped) |
| `dashboard` | A dashboard of the Preview plugin (`dashboards/<name>/`), refreshed every `interval_seconds` (at least 60, default 15 minutes) by running its refresh scripts, only while the person's approval still matches their exact content, under the session's sandbox (never with full access). The Dashboards pane's **Keep fresh** adds one for 7 days. It never wakes the agent: its result shows only in the Watches list. | How many sources refreshed and which failed |

`when` chooses what counts as news:

- `change` (default): any different result. The first check is the silent baseline.
- `match` / `no_match`: the output starts or stops matching `pattern` (a regular expression, tested against the last 16 KB of the output). Patterns run on the app's main thread, so ones longer than 300 characters, or that repeat a group which itself repeats or has alternatives (such as `(a+)+` or `(a|b)*`), are refused.
- `fails` / `succeeds`: the exit code becomes non-zero / zero; for a port, it goes down / comes up.

Conditions notify when they become true, not on every check while they stay true. For a files watch, `pattern` chooses which changed paths count.

Any difference in a command's output counts as a change, so keep it stable: leave out timestamps, timings and counters (for example `npm run lint --silent 2>&1 | tail -n 30`, or `git status --porcelain`).

## When the agent is woken

- **Only when idle.** A change seen while the agent is idle wakes it with a notice: what changed, the exit code before and now, and up to 40 changed lines (cut to 2 KB). If the agent has started working by the time the notice may go out, it gets the notice at its next step instead.
- **Never by its own work.** While the agent works, checks run but report nothing. When any turn ends, each watch takes the state then as its new baseline (commands and ports are checked once more right then; file events in the next 1.5 seconds are dropped).
- **Cooldown:** at least `cooldown_seconds` between two notices (at least 10, default 60). Changes in between are merged into one notice with the latest result.
- **Notice limit:** `max_wakes` notices (default 20, at most 200). The last one says the watch has stopped, and it is removed.
- **Lifetime:** `lifetime_minutes` (default one day, at most a week).
- Ten watches per session, fifty in all.

Watches belong to the top-level session; helper agents cannot create them. A watch is removed when its session is archived (Harness's archive event, and a sweep every 30 seconds), when its lifetime ends, when it uses its last notice, or when the agent or you remove it.

## Tools

- `watch_create` — `kind`, `label`, `command` / `port` + `host` / `paths` / `dashboard`, `when`, `pattern`, `interval_seconds`, `timeout_seconds`, `cooldown_seconds`, `max_wakes`, `lifetime_minutes`. Runs the first check before returning and shows it as the baseline; a command that cannot run (for example because no sandbox is usable) is refused.
- `watch_list` — the session's watches with their latest result and notices used.
- `watch_remove` — `watch_id`, or `all: true`.

A short line in the system prompt tells the agent to use a watch instead of polling, sleeping or scheduling repeated checks.

## In the app

An eye button in the session header, just left of Harness's Schedule clock, shows how many watches the session has; with none running it steps out of the header, and **Watches** in the Preview plugin's Panes menu opens the same list (it sends a `harness-studio:open-watches` window event with the Session id). It opens a list with what each watch checks, its latest result, when it last checked and last sent a notice, and how many notices it has used, with a remove button per row and Remove all. **+ Add a watch** adds a command, port or files watch without asking the agent; the agent is told when you add or remove one, without being woken.

## Where watches are kept

`<home>/harness-studio/watches.json` (`~/.harness-studio/harness-studio/watches.json` in the app), replaced atomically on each change and readable only by you (it holds commands and their output). Watches resume when the app starts; a session that is not loaded yet is loaded when its watch first needs the session's sandbox policy. A file that cannot be read is moved aside to `watches.json.corrupt-<time>`.

## Security

- Command watches run exactly as the agent's own commands would: under the session's current sandbox mode and network policy, resolved at every run, so a permission change applies from the next check and a watch can never escalate. The credential scrub, process-group kill and time limit come from Harness's runner.
- Port watches only connect to this computer.
- Under the Auto permission mode, creating a watch is reviewed like any other tool call.

## Development

```sh
npm test
```

`test/logic.test.mjs` covers the comparisons, conditions, cooldown, notice limit, diff and notice size; `test/run.test.mjs` the port probe and file events against the real operating system; `test/host.test.mjs` the Host half against a fake Harness with a mocked clock (waking only when idle, the turn-end baseline, merging, archive removal, saving and resuming, the header list's actions).
