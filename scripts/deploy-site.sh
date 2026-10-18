#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
branch="gh-pages"
push=0

for arg in "$@"; do
  case "$arg" in
    --push) push=1 ;;
    *) echo "usage: scripts/deploy-site.sh [--push]" >&2; exit 2 ;;
  esac
done

if [ -n "$(git -C "$root" status --porcelain -- apps/site)" ]; then
  echo "apps/site has uncommitted changes; commit them first so the published site matches a commit." >&2
  exit 1
fi

pnpm --dir "$root/apps/site" install --frozen-lockfile
pnpm --dir "$root/apps/site" build

source_sha="$(git -C "$root" rev-parse --short HEAD)"
work="$(mktemp -d "${TMPDIR:-/tmp}/vivepdf-site.XXXXXX")"
cleanup() {
  git -C "$root" worktree remove --force "$work" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

git -C "$root" fetch origin "$branch" >/dev/null 2>&1 || true
if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$root" worktree add "$work" "$branch"
elif git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git -C "$root" worktree add -b "$branch" "$work" "origin/$branch"
else
  git -C "$root" worktree add --detach "$work"
  git -C "$work" checkout --orphan "$branch"
  git -C "$work" rm -rf --quiet .
fi

rsync -a --delete --exclude ".git" "$root/apps/site/dist/" "$work/"
git -C "$work" add --all
if git -C "$work" diff --cached --quiet; then
  echo "The published site is already up to date with $source_sha."
else
  git -C "$work" commit --quiet -m "Publish the website from $source_sha"
  echo "Committed the site from $source_sha to $branch."
fi

if [ "$push" -eq 1 ]; then
  git -C "$root" push origin "$branch"
else
  echo "Not pushed. Run with --push to publish $branch to GitHub Pages."
fi
