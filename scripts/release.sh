#!/usr/bin/env bash
# Publish a release of Harness Studio from this development repository to the public production repository.
#
# The development repository (this one) keeps the full history. The production repository receives one
# commit per release containing exactly the files committed at the chosen development commit, so work in
# progress, local edits and history never reach it. The script never force-pushes or rewrites the production
# history: if production has moved in a way a plain push can't follow, the push fails and nothing changes.
#
# Usage:
#   scripts/release.sh [--dry-run] [--ref <commit>] [--message "<summary>"]
#
#   --dry-run   build the release commit in a temporary folder and show what would change, without pushing
#   --ref       the development commit to release (default: HEAD)
#   --message   one-line summary for the release commit (default: "Harness Studio <desktop/VERSION>")
#
# Environment:
#   HARNESS_STUDIO_PROD_REPO   production repository URL (default: https://github.com/vigneshv1cky/harness-studio.git)
#   RELEASE_AUTHOR             commit author (default: Vignesh Murugan <97196163+vigneshv1cky@users.noreply.github.com>)
#
# Paths listed in .release-exclude (one per line; # comments allowed) are left out of releases.
set -euo pipefail

PROD_REPO="${HARNESS_STUDIO_PROD_REPO:-https://github.com/vigneshv1cky/harness-studio.git}"
AUTHOR="${RELEASE_AUTHOR:-Vignesh Murugan <97196163+vigneshv1cky@users.noreply.github.com>}"
DRY_RUN=0
REF=HEAD
SUMMARY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --ref) REF="${2:?--ref needs a commit}"; shift ;;
    --message) SUMMARY="${2:?--message needs text}"; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
COMMIT="$(git rev-parse --verify "$REF^{commit}")"
SHORT="$(git rev-parse --short "$COMMIT")"
VERSION="$(git show "$COMMIT:desktop/VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$SUMMARY" ] || SUMMARY="Harness Studio ${VERSION:-release}"

if [ -n "$(git status --porcelain)" ]; then
  echo "release: note: uncommitted changes in this checkout are not part of the release (publishing $SHORT)." >&2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/harness-studio-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PROD="$WORK/prod"

# Start from production's current main, or from an empty repository for the first release.
if git ls-remote --exit-code --heads "$PROD_REPO" main >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch main "$PROD_REPO" "$PROD"
  FIRST=0
else
  git init --quiet -b main "$PROD"
  git -C "$PROD" remote add origin "$PROD_REPO"
  FIRST=1
fi

# Replace the tracked contents with the release commit's files.
git -C "$PROD" ls-files -z | (cd "$PROD" && xargs -0 rm -f --)
find "$PROD" -mindepth 1 -type d -not -path "$PROD/.git*" -empty -delete 2>/dev/null || true
git archive "$COMMIT" | tar -x -C "$PROD"

if [ -f "$ROOT/.release-exclude" ]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="$(printf '%s' "$line" | sed 's/[[:space:]]*$//')"
    [ -n "$line" ] && rm -rf "${PROD:?}/$line"
  done < "$ROOT/.release-exclude"
fi

git -C "$PROD" add -A
if git -C "$PROD" diff --cached --quiet; then
  echo "release: production already matches $SHORT; nothing to publish."
  exit 0
fi

echo "release: changes for $SUMMARY (from $SHORT):"
git -C "$PROD" diff --cached --stat | tail -15

NAME="${AUTHOR%% <*}"; EMAIL="${AUTHOR##*<}"; EMAIL="${EMAIL%>}"
git -C "$PROD" -c user.name="$NAME" -c user.email="$EMAIL" commit --quiet \
  -m "$SUMMARY" -m "Released from the Harness Studio development repository at $SHORT."

if [ "$DRY_RUN" = 1 ]; then
  echo "release: dry run; the release commit was built but not pushed."
  exit 0
fi

git -C "$PROD" push --quiet origin main
echo "release: published $SUMMARY to $PROD_REPO ($( [ "$FIRST" = 1 ] && echo 'first release' || echo 'new release commit'))."
