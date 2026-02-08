#!/usr/bin/env bash
set -euo pipefail

BUMP_TYPE="${1:?Usage: release.sh <major|minor|patch>}"

case "$BUMP_TYPE" in
  major|minor|patch) ;;
  *) echo "Invalid bump type: $BUMP_TYPE (use major, minor, or patch)" >&2; exit 1 ;;
esac

TAG="release:$BUMP_TYPE"
echo "Pushing trigger tag '$TAG' to start CI release..."
git tag "$TAG"
git push origin "$TAG"
