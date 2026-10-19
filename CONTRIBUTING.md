# Contributing to vivePDF

Thank you for helping. Bug reports, ideas, translations, documentation fixes and code are all welcome.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

Bugs go to [Issues](https://github.com/mtvrkan/vivePDF/issues), where the bug report form asks for what a fix needs; questions and early ideas go to [Discussions](https://github.com/mtvrkan/vivePDF/discussions). **Help › Report a bug** in the app fills in the version, the system and, if you allow it, diagnostic details. A small sample file that shows the problem makes a fix much faster; remove anything personal from it first. Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setting up

Prerequisites, commands and the project layout are in the [README](README.md#development) and the [Build from source](https://vivepdf.com/en/docs/build-from-source/) guide.

## Pull requests

- Keep each pull request to one change, and describe what it fixes or adds and how you checked it.
- Add or update tests with the change: `pnpm test` / `pnpm typecheck` / `pnpm lint` in `apps/desktop`, `uv run pytest` and `uv run ruff check .` in `sidecar`, `cargo clippy -- -D warnings` and `cargo test` in `apps/desktop/src-tauri`.
- PDF work belongs in the Python engine (`sidecar/vivepdf/ops`); operations never overwrite the input file and report errors with an error code.
- Every user-facing string goes through the translation files in `apps/desktop/src/locales`; add the Turkish and English text, and leave other languages to translators if you do not speak them.
- Note user-visible changes in `CHANGELOG.md` under **Unreleased**.

## Translations

The interface comes in 8 languages. Corrections to an existing language are a pull request against `apps/desktop/src/locales/<language>/common.json`; for a new language, open an issue first.

## License

By contributing you agree that your contribution is licensed under the AGPL-3.0, the same license as the project.
