# Castle Siege — notes for Claude Code sessions

- The spec is `docs/GDD.md`. Rule interpretations and beta changes are in `docs/RULES-NOTES.md`; keep that file updated when rules change.
- The engine (`src/engine`) must stay free of UI imports. Every rule change goes through `applyAction(state, action)` and must be deterministic (use `src/engine/rng.ts` with the RNG in state; AI code uses `aiRng`, which never mutates state).
- Content and numbers belong in `/data/*.json`, not in code.
- Before committing, run `npm run typecheck`, `npm test` and `npm run build`. For balance work, run `npm run sim -- --games 100` and update `docs/BALANCE.md`.
