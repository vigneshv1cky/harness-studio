# AGENTS.md

Instructions for coding agents working on this repository, including Harness Studio's own agent.

## Changes that need a restart

When you run inside Harness Studio and change Harness Studio's own code, some changes only take effect after the app restarts, and you cannot restart it from inside: the app you run in is the one that would have to restart.

- Reload on their own: a plugin's client half (`plugins/*/client.js` and what it imports).
- Need a restart: a plugin's host half (`plugins/*/index.js` and the modules it imports), a plugin's `cordis.patch.yml`, and Harness itself (`harness/`, which also needs `pnpm --dir harness run build:artifacts` first).

After a change that needs a restart, stop and tell the user: what changed, that Harness Studio needs a restart to load it, and how to check it afterwards. Do not inspect processes, ports, logs or debuggers to find out whether the running app has picked the change up; it has not.
