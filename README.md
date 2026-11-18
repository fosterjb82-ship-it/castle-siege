# Castle Siege (beta)

A digital co-op board game with cards, set in medieval times. Defenders build up a castle together and draft hidden siege decks. Then the Warlord sounds the War Horns and the team has to hold the Keep through the siege.

This repository is the **first playable beta** built from the design spec in [`docs/GDD.md`](docs/GDD.md). It covers milestones M1–M6 from the spec.

| | |
|---|---|
| **Modes** | Co-op vs AI Warlord (1–4 hot-seat players split the 4 characters) · Warlord mode (a human Warlord vs 1–4 human defenders, hot-seat with privacy screens) |
| **Rules** | Full Build Phase (build/upgrade, draft, train, move, trade, abilities, raids, harass), War Horns, and the 5-round Siege Phase with face-down planning, a simultaneous reveal, 5-step resolution, breaches, bailey fights, the Keep and victory |
| **Data-driven** | Cards, buildings, troops, characters, map and every tunable live in `/data/*.json`. Tuning needs no code changes. |
| **Playtest tools** | Game log, debug panel (grant resources, jump to War Horns, reveal hidden info, undo, set seed, AI-move, export/import state), autosave and save files, log export, headless AI-vs-AI simulation |

## Quick start

Needs Node 18 or later.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Other commands:

```bash
npm test
```

```bash
npm run build
```

```bash
npm run sim -- --games 200 --difficulty all
```

`npm test` runs the Vitest unit tests (setup, every build action, every siege resolution step, victory, determinism). `npm run build` typechecks and builds a static site into `dist/` that you can host anywhere. `npm run sim` runs the headless balance simulation.

### Simulation options

```bash
npm run sim -- --games 100 --difficulty normal --seed 1
```

```bash
npm run sim -- --log 42
```

```bash
npm run sim -- --games 100 --override sim-variants/example-tougher-warlord.json
```

```bash
npm run sim -- --games 200 --difficulty all --json results.json
```

`--log <seed>` prints the full game log of one AI-vs-AI game. `--override` tests a data variant without editing `/data`; see the example file for its shape. `--json` writes the summary stats to a file.

The report includes the defender win rate, the average War Horns round, how many games had a breach and when, breaches by lane, raid results, win reasons, and the most drafted and played cards. See [`docs/BALANCE.md`](docs/BALANCE.md) for the current results.

## How to play (short)

1. **Setup.** Defenders secretly place 3 Militia and the Knight. The Warlord secretly places the Main Siege Camp and 3 Footmen. Then everything is revealed.
2. **Build rounds.** Collect income, then the team picks which character goes next. Defender troops are capped by Garrison Capacity (the Keep plus a Barracks or Garrison Hall). Militia Levy can raise townsfolk beyond the cap while the castle's Population lasts. Each character takes 2 actions, and the Warlord responds with 1 action after each character's turn. Click a slot on the board to see what you can build there.
3. **War Horns.** The Warlord may sound them from round 4; they sound automatically after round 8. Defenders then get one final build round, and the Warlord makes no moves in it.
4. **Siege (5 rounds).** Each character plays 1 card face down onto a lane, plus an optional character ability and hidden troop moves. The Warlord plays 3 cards. Everything is revealed at once and resolves in order: Scouting → Ranged → Engines → Melee → Recovery.
5. **Winning.** Defenders win if the Keep stands after the last round. The Warlord wins the moment the Keep falls.

## Project layout

```
data/                 all game content and tunables (JSON)
  rules.json          starting resources, income, actions, horns window, siege rounds, hand sizes, beta rule switches, AI tunables
  map.standard.json   lanes, adjacency, slot counts, tower corners, starting structures
  buildings.json      defender and Warlord buildings (cost, slot, effects, upgrades)
  troops.json         troop stats
  cards.defender.json Tactics / Fortifications / Garrison decks (typed effect handlers)
  cards.warlord.json  Tactics / Troops / Siege Engines decks
  characters.json     the four defender characters
src/engine/           pure-TypeScript rules engine (no UI imports)
  types.ts            state, actions, data types
  setup.ts            createGame()
  build.ts            Build Phase actions and round flow
  siege.ts            siege planning and the 5-step resolution
  engine.ts           applyAction / tryAction / pendingActors / legal-action enumeration
  ai/                 AI Warlord (GDD §15) and a heuristic defender AI (for simulation)
src/sim/              headless simulation runner and data overrides
src/ui/               React + SVG front end
tests/                Vitest unit tests
docs/GDD.md           the design spec this build follows
docs/RULES-NOTES.md   every rule interpretation and beta rule change
docs/BALANCE.md       simulation findings and suggested tuning levers
```

### Engine API

```ts
import { createGame, applyAction, tryAction, pendingActors, runAI } from './src/engine';

let s = createGame({ mode: 'coop', difficulty: 'normal', seed: 'my-seed' });
s = applyAction(s, { type: 'setupDefenders', militia: ['N', 'E', 'S'], knight: 'N' });
s = runAI(s); // the AI Warlord places its camp and troops
```

The state is a plain serializable object, so save/load, undo, replays and tests are simple. `RULES-NOTES.md` explains how the card effect types (`attackBonus`, `defenseBonus`, `deployTroops`, `engine`, `peekHand`, ...) map to resolution steps.

## Status

- All of M1–M6 is in place and every unit test passes.
- **Balance is not done.** In AI-vs-AI simulation the defenders win almost every game. `docs/BALANCE.md` explains why and which levers to try first. The GDD asks for numbers to be set by playtesting, and the simulation and override tools are there for that.
- Placeholder visuals only (SVG shapes, emoji icons).
