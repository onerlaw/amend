#!/usr/bin/env bash
set -euo pipefail

BUMP_TYPE="${1:?Usage: release.sh <major|minor|patch>}"

# Read current version from package.json
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *) echo "Invalid bump type: $BUMP_TYPE (use major, minor, or patch)" >&2; exit 1 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "Bumping $CURRENT -> $NEW_VERSION"

# Update version in all three files
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# Commit, tag, and push
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin main --tags

echo "Released v$NEW_VERSION"
