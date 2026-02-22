#!/usr/bin/env bash
set -euo pipefail

BUMP_TYPE="${1:?Usage: release.sh <major|minor|patch>}"

case "$BUMP_TYPE" in
  major|minor|patch) ;;
  *) echo "Invalid bump type: $BUMP_TYPE (use major, minor, or patch)" >&2; exit 1 ;;
esac

echo "Triggering manual $BUMP_TYPE release via workflow_dispatch..."
gh workflow run release.yml -f bump_type="$BUMP_TYPE"
echo "Release workflow triggered. Watch progress: gh run watch"
