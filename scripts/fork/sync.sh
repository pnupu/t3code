#!/usr/bin/env bash
# Rebases the fork's commits onto the newest upstream stable release and pushes main;
# the push publishes a release (fork-release.yml). Runs from a clone of pnupu/t3code
# with push access. Exit 0: synced or nothing to do. Exit 3: the rebase stopped on a
# conflict and is left in progress to resolve, then `git rebase --continue` and push.
set -euo pipefail

upstream=https://github.com/pingdotgg/t3code.git
repo=pnupu/t3code

if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
  echo "A rebase is already in progress; resolve it first." >&2
  exit 3
fi

git fetch -q origin main --tags
git checkout -q -B main origin/main
before=$(git rev-parse HEAD)

tags=$(git ls-remote --tags --refs "$upstream" | awk '{sub("refs/tags/","",$2); print $2}' \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V -r | head -20)
latest=$(head -1 <<< "$tags")
base=""
for tag in $tags; do
  git fetch --no-tags -q "$upstream" "refs/tags/$tag:refs/upstream/$tag"
  if git merge-base --is-ancestor "refs/upstream/$tag" HEAD; then base="$tag"; break; fi
done
test -n "$base" || { echo "main is not based on an upstream stable tag." >&2; exit 1; }
if [[ "$base" == "$latest" ]]; then
  echo "Already on $latest."
  exit 0
fi

echo "Rebasing $(git rev-list --count "refs/upstream/$base..HEAD") fork commits from $base onto $latest."
if ! git rebase --onto "refs/upstream/$latest" "refs/upstream/$base"; then
  title="Upstream $latest does not apply cleanly"
  if [[ -z "$(gh issue list -R "$repo" --label fork-sync --state open --search "\"$title\" in:title" --json number --jq '.[].number')" ]]; then
    gh issue create -R "$repo" --label fork-sync --title "$title" \
      --body "Rebasing the fork commits from $base onto $latest stopped on a conflict. Machines stay on the last release until main is pushed."
  fi
  exit 3
fi

git push -q --force-with-lease="main:$before" origin main
echo "Pushed main on $latest; fork-release.yml publishes it."
