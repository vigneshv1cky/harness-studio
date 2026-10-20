# Harness fork plan

Status (2026-10-18): rollout steps 1 to 3 are done, and the first upstream drop is merged. The fork `vigneshv1cky/harness-studio-core` has `studio` = upstream plus one commit per former patch and the icons (`studio-v0.3.0`, identical to what 0.3.0 was built from), then upstream 0.2.1-rc.2 merged (one conflict, the Windows installer strings) and a test fix for the computer-use helper step, at `502711e5f1`. The build scripts and the dev copy use the fork; macOS and Linux x64 and arm64 built from `502711e5f1` passed their smoke tests. The patch folders stay as the 0.3.0 fallback until the next release (step 5).

Today Harness Studio builds from DeepSeek Harness commit `571902028a75c64c1d767f4ae5fd099485f0ddf0` (0.2.1-alpha.3) plus 31 patch files: `patches/harness-studio-brand.patch`, `patches/harness-studio-account.patch` and `desktop/patches/01` to `29`, then `scripts/copy-logo.sh` copies the PNG icons. This plan replaces the patch files with a git fork whose branch holds the same changes as ordinary commits, keeps upstream as a merge source, and leaves the app repository small.

## 1. The fork

- **Repository:** `vigneshv1cky/harness-studio-core`, created with GitHub's Fork button from `deepseek-ai/deepseek-harness`, then renamed. It is public: the public app repository and its release builds must be able to clone it, and forking keeps the full upstream history and the MIT licence file.
- **Branches:**
  - `master` mirrors upstream and is never committed to.
  - `studio` is Harness Studio's branch, the only one builds use.
- **Tags:** `studio-v<app version>` on the exact `studio` commit each app release is built from, starting with `studio-v0.3.0`.
- **Package names** stay `@deepseek-ai/dsh-*` for now; renaming them touches every package and makes each upstream merge conflict.

## 2. Turning the 31 patches into commits

Done once, in a fresh clone, so the dev copy and its data are not touched until the end.

1. Clone the fork and create `studio` from the pinned commit.
2. For each patch in the current build order (brand, account, then `01` to `29`): apply it with `git apply`, commit everything with the patch's name as the title and its row from the `desktop/README.md` patch table as the body, authored as Vignesh with the co-author line. That gives 31 commits, one per patch, in the same order.
3. One more commit, "Harness Studio icons", adds the PNG icons `scripts/copy-logo.sh` copies today, so builds no longer need that script.
4. **Check that nothing changed:** apply the 31 patch files and run `copy-logo.sh` on another fresh clone of the pin, then compare it file by file with the `studio` tree (the same comparison used for the dev copy rebuild). It must report no differences.
5. Push `studio`, and tag it `studio-v0.3.0`, since this tree is byte for byte what 0.3.0 was built from.

The optional `patches/harness-browser-pane.patch` is not a commit. The release set uses `04-browser-pane-sign-in-setting` instead, and the dev copy already runs the release set. It is retired with its `NOTICE.md` in step 5.

## 3. What changes in this repository

**`docs/HARNESS_PIN.md`** keeps its name and its machine-read line, so the scripts' parsing changes least:

- `Fork: https://github.com/vigneshv1cky/harness-studio-core` (branch `studio`)
- `Pinned commit: <40-hex studio commit>`
- `Upstream base: 571902028a75…` (the upstream commit `studio` last merged), for reference only

The re-create instructions become "clone the fork, check out the pinned commit". The patch commands and the browser-pane opt-in section go.

**`desktop/build-mac.sh`, `desktop/build-linux.sh`, and the dormant `desktop/build-windows.sh`**:

- The default repository becomes the fork; `HARNESS_UPSTREAM` keeps working as the override, renamed in the comment to "the Harness repository cloned".
- The patch loop and the `copy-logo.sh` call are removed.
- New guard: the pinned commit must be reachable from the fork's `studio` branch, so a build never uses an unpublished commit.

**Smaller edits:**

- the paused Windows smoke workflow;
- `scripts/copy-logo.sh`, kept only to regenerate the icons commit when the logo changes;
- the references in `README.md`, `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/SESSIONS_DESIGN.md` and `plugins/devpreview/README.md`.

**`desktop/README.md`:** the patch table becomes a "Changes on the fork" list linking each commit. "Moving to a new Harness commit" is replaced by section 5 below.

**The dev copy, `harness/`:**

- `origin` points at the fork, and `upstream` is added for DeepSeek.
- `studio` is checked out over the identical working tree, so its build output and the dev app's sessions, settings and browser data inside it stay put.
- From then on, a Harness change is a commit in `harness/` pushed to the fork, followed by a new pinned commit here.

**Release flow:** before `scripts/release.sh`, the pinned `studio` commit must be pushed and tagged. The public app repository then shows a pin that anyone can clone.

## 4. Rollout order

1. Create the fork and the `studio` branch, and run the check in section 2, step 4.
2. Switch the build scripts and `HARNESS_PIN.md`. Build macOS locally and Linux on GCP from the fork, and run both smoke tests.
3. Switch the dev copy's remotes and branch.
4. Release the next version from the fork.
5. After that release passes, delete `patches/` and `desktop/patches/`. Until then they stay as the fallback: reverting the scripts commit restores the old build exactly.

## 5. Merging an upstream drop

DeepSeek publishes Harness in large squashed drops (the pinned commit is one "sync 0.2.1-alpha.3 to master" merge), so each merge is a deliberate step, not a routine pull.

1. `git fetch upstream`, and fast-forward the fork's `master` to the new drop.
2. Read the drop's changelog and upgrade guides for anything touching the areas the 31 commits change: desktop main, the CLI, the sandbox, the system prompt, the headless runner, the right panel and document preview.
3. On a branch `merge/<upstream version>` from `studio`, run `git merge upstream/master`. Merge, never rebase: the commits behind earlier releases keep their ids, so every old release can still be rebuilt.
4. Resolve conflicts commit area by commit area. Each conflict is shown line by line against the change that caused it, instead of a whole patch failing.
5. Check:
   - `pnpm install`, then `pnpm run build`, which includes the type check that packaging runs;
   - the Harness tests for the changed areas (the list in `desktop/README.md`);
   - the plugins' own tests;
   - the dev app on its own data.
6. Build macOS and Linux and run both smoke tests.
7. Merge `merge/<version>` into `studio`, push, then update `Pinned commit:` and `Upstream base:` here and commit.

If a drop is not worth taking, skip it; `studio` keeps working on its own.

## Risks and decisions

- **Upstream fixes** reach Harness Studio only through step 5, so a security fix in the sandbox or a provider needs its own quick merge. Watch upstream's releases.
- **Size:** the fork carries about 480,000 lines; the app repository does not grow.
- **To decide before starting:**
  - the fork's name (proposed `harness-studio-core`);
  - whether brand and account become one commit or two (proposed two, as today);
  - whether to keep the browser-pane opt-in patch as a commit on a side branch (proposed no).
