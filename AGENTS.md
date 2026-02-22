# Agents

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commits and PR titles **must** follow this format:

```
<type>[optional scope][!]: <description>
```

### Types

- `feat` — A new feature (triggers a **minor** release)
- `fix` — A bug fix (triggers a **patch** release)
- `docs` — Documentation only changes
- `style` — Formatting, missing semicolons, etc. (no code change)
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `perf` — Performance improvement
- `test` — Adding or updating tests
- `chore` — Build process, tooling, or dependency changes
- `ci` — CI/CD configuration changes

### Breaking Changes

Append `!` after the type/scope to indicate a **breaking change** (triggers a **major** release):

```
feat!: remove legacy API endpoints
fix(auth)!: change token format
```

### Examples

```
feat: add inline rename in file browser
feat(terminal): add process exit confirmation
fix: resolve crash on empty git repo
fix(editor): correct syntax highlighting for YAML
docs: update README with build instructions
chore: upgrade tauri to v2.1
refactor(store): simplify terminal state management
```

### Release Automation

Releases are triggered automatically on merge to `main`. The CI inspects commit messages since the last release tag and determines the version bump:

- Any `feat` commit → minor release
- Any `fix` commit (and no `feat`) → patch release
- Any `!` or `BREAKING CHANGE` → major release
- Only `chore`, `docs`, `refactor`, `ci`, etc. → no release

Commits that don't follow conventional commit format will be categorized under "Other Changes" in the release changelog.
