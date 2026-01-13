# Repository Guidelines

## Project Structure & Module Organization

- `src/` holds TypeScript sources. Server entrypoints live in `src/server.ts` and `src/gui/server.ts`.
- `src/server/` contains MCP server modules (config, documents, prompt logic).
- `src/gui/` contains the local web UI server and assets.
- `data/` stores prompt documents (`.md`, `.txt`, `.pdf`) used by the MCP server.
- `scripts/` has local utilities and smoke tests.
- `dist/` is the build output (`npm run build` writes here).

## Build, Test, and Development Commands

- `npm install` installs dependencies.
- `npm run build` compiles TypeScript into `dist/`.
- `npm run start` runs the MCP server from `dist/server.js`.
- `npm run dev` runs the MCP server directly from TypeScript.
- `npm run gui` builds and starts the local GUI.
- `npm run gui:watch` runs the GUI in watch mode for development.
- `npm run test:gui` runs the GUI smoke test.
- `node scripts/test-docs.mjs "query"` searches prompt docs and prints a snippet.

## Coding Style & Naming Conventions

- TypeScript, ES modules (`"type": "module"`).
- Indentation is 2 spaces; keep imports grouped and sorted.
- Use clear, scoped naming in modules (e.g., `server/documents.ts`, `server/prompt.ts`).
- No formatter or linter is configured; keep style consistent with existing files.

## Testing Guidelines

- No formal test framework; use scripts for smoke coverage.
- GUI tests: `npm run test:gui`, `npm run test:gui:codex-image`.
- Keep test scripts in `scripts/` and use descriptive filenames like `test-*.mjs`.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits with scopes, e.g. `feat(gui): ...`, `fix(server): ...`.
- PRs should include a concise summary, testing notes, and screenshots for GUI changes.
- Link related issues when applicable.

## Security & Configuration Tips

- Local LLM integration is gated by env vars: `ENABLE_COMMAND_LLM=1`, `ENABLE_HTTP_LLM=1`.
- Keep API keys in local GUI storage; do not commit secrets.
