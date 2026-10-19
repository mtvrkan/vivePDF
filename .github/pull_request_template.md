## What this changes

## How it was checked

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` in `apps/desktop` (UI changes)
- [ ] `uv run pytest` and `uv run ruff check .` in `sidecar` (engine changes)
- [ ] `cargo clippy -- -D warnings` and `cargo test` in `apps/desktop/src-tauri` (Rust changes)
- [ ] New user-facing text has Turkish and English entries in `apps/desktop/src/locales`
- [ ] User-visible changes are noted in `CHANGELOG.md` under **Unreleased**
