# Balance report (beta v0.1)

**Short version: in AI-vs-AI simulation the defenders win every game, at every difficulty.** The rules engine, AI and tools work. The numbers and parts of the combat model need a designer's decisions; the GDD expects these to be "set through playtesting". This report shows what the simulator found, what was changed while building the beta, and which levers to try next.

## Current results

`npm run sim -- --games 100 --difficulty all` (seeds 1–100, AI defenders vs AI Warlord):

| | Easy | Normal | Hard |
|---|---|---|---|
| Defender win rate | 100% | 100% | 100% |
| Games with a breach | 44% | 58% | 54% |
| Avg siege round of first breach | 3.0 | 3.2 | 2.9 |
| Avg siege rounds played | 4.1 | 4.5 | 4.4 |
| Avg Keep HP at end (of 8) | 7.99 | 7.99 | 7.93 |
| Ended by "Warlord has no troops left" | 66% | 40% | 49% |
| Avg War Horns round | 5.9 | 5.9 | 5.9 |

The target in the GDD is 50–60% defender wins in co-op on Normal. Breaches happen in about half of all games, but the Warlord almost never damages the Keep.

Most drafted cards: Footmen Wave, Battering Ram, Raider Band, Burning Oil, Trebuchet, Archer Company. Breaches are spread evenly across the four lanes.

Caveat: the defender AI plays well. It concentrates every card, troop and the Knight on the visibly threatened lane. Human players may do worse, so try a few human co-op games before drawing firm conclusions.

## Update: food

Normal, 100 games: defender win rate **99%** (1 Warlord win), breaches 62%, Keep HP at end 7.78 (was 7.97).

Food creates real pressure. AI defenders went hungry in 21 of 40 sampled games, about 0.6 hungry siege rounds per game. They mostly got by on starting Food, Keep income and trades, building only 0.25 Granaries per game; human players may plan differently. Tunables: `rules.food.troopsPerFood` (lower = hungrier), the starting Food in `rules.startingResources.defender.food`, Granary output, and `rules.food.hungerStrengthPenalty`. A desertion rule (losing troops after repeated hunger) is a possible later step, but it is not implemented.

## Update: defender troop cap (Garrison Capacity + Population)

Normal, 100 games: defender win rate **100%**, breaches 66%, Keep HP at end 7.97. A tighter cap (base 4) and a looser one (base 8) gave the same result over 50 games each.

The cap is binding: defenders end the game with 9–13 troops instead of 15–20, and Militia Levy is now a popular draft (it was 170 picks across these games). The win rate doesn't move because the defense in the threatened lane still reaches 24–36: every troop, all four defense cards and Rally pile into the one lane the Warlord visibly commits to. Meanwhile the AI Warlord attacks with only 3–12. So the remaining gap is **Warlord offense and concealment**, not defender numbers. Next levers:
- Let the Warlord shift troops between adjacent approaches as a hidden siege move. Then defenders can't stack everything in one lane.
- Limit how much troop Strength counts toward a lane's Defense, for example only troops on the wall that faces the attack, up to a few.
- Give the Warlord more siege cards per round, or troop cards that arrive at full force.

## Update: siege engines (Catapult, sheltering Siege Tower, piercing Ram)

`npm run sim -- --games 100` (Normal, seeds 1–100), compared with the table above:

| | Before | After |
|---|---|---|
| Defender win rate | 100% | 99% (first Warlord win by Keep assault) |
| Games with a breach | 58% | 66% |
| Ended by "Warlord has no troops left" | 40% | 25% |
| Avg Keep HP at end | 7.99 | 7.85 |

The Catapult became the 3rd most drafted card. Armies now survive longer: tower attrition is lower and more sieges reach round 5. But breaches still rarely turn into Keep damage. The structural issues below (no defender troop cap, a visible attack lane) are still the main levers.

## What the simulator found, and what changed

Each of these was found by running the sim on the spec's rules as written. The fixes are in `data/rules.json` and are explained in `RULES-NOTES.md`.

| Finding | Effect on the spec rules | Beta change |
|---|---|---|
| The Knight's −1 Gold discount makes Militia free | Unlimited free troops | Discounts can't make a cost free |
| The Warlord had no Gold or Timber income | Couldn't afford Supply Lines, War Camps or drafts | +1 Supplies, +1 Timber, +1 Gold base income |
| Raids on empty approaches always win | 846 raids won, 0 lost in 100 games; Warlord economy wiped out | +2 defending Strength per Warlord building (camp guards) |
| Towers shot every Warlord troop on the map each round | The whole army died in siege round 1 | Only troops in lanes "under attack" can be shot |
| An empty bailey is the only way to reach the Keep | Keep never damaged once defenders rush the breach | Bailey-fight margin carries through to the Keep |
| A bailey fight costs only 1 troop per round | Breaches never turned into wins | Bailey casualties scale with the margin (1 per 3) |
| Reinforcements landed outside a breach and got shot walking in | The breach was fed a few troops at a time | Troop cards played on a breached lane deploy inside |
| 4 Warlord actions per round vs 8 for defenders | The army was too small to matter | Recruit up to 3 troops per action |

The win rate stayed at 100%, but these changes took the game from "the Warlord's army dies in round 1" to "sieges last the full 5 rounds and breach about half the time".

## Why the Warlord still loses (structural)

1. **Defender troops have no cap; Warlord troops do.** Supply Rating caps the Warlord at about 11–15 troops. Defenders end the build phase with 15–20 troops at Strength 2 each (Garrison Hall), and every one adds directly to lane Defense in the combat formula.
2. **Defender ranged fire wears the attackers down every round.** Each lane is covered by two corner towers, and Archer Company adds two archers that fire every round from then on. Together they kill 3–5 one-HP attackers per round in the lane under attack.
3. **The attack lane is never a surprise.** Warlord troops are visible and can't move between approaches during the siege, so defenders always know where to send everything. Face-down cards and Decoys add little bluffing while the army's position gives the plan away.
4. **The instant-loss rule ends many sieges early.** "No troops on board and no troop cards" ended 40–66% of games, even with engines still on the board.

## Levers to try next (all data, no code)

Use `npm run sim -- --override file.json`; `sim-variants/example-tougher-warlord.json` shows the format. In 20-game sweeps, none of the following moved the AI-vs-AI win rate off 100%, alone or combined. The strongest combination tried raised the breach rate from about 58% to 75%: troop HP 2, pricier towers and archers, 6 siege rounds and 4 Warlord cards per round. Even then the Keep stayed at full HP. The levers:

- Warlord troop HP: `troops.footmen.hp` and `troops.raiders.hp` from 1 to 2.
- Tower and archer cost: `buildings.arrow_tower.cost`, `troops.archers.cost`, and `cards.archer_company.effects[0].count`.
- Siege length and Warlord cards: `rules.siegeRounds`, `rules.warlordCardsPerRound` and `rules.handSize.warlord`.
- Keep strength: `map.startingStructures.keep`.
- Supply Rating and income: `buildings.main_siege_camp.supplyRating` and `.produces`, `buildings.siege_camp.supplyRating`, `rules.ai.difficultyIncome`.

Rule changes worth considering:
- **A defender troop cap**, such as a garrison limit per bailey, or upkeep, to mirror the Warlord's Supply Rating.
- **Let the Warlord shift troops between adjacent approaches during the siege.** For example, March as a hidden siege move. Feints would then matter.
- Count engines in the instant-loss check, or drop it.
- Count only some of the defender troops' Strength toward wall Defense, so the walls rather than the garrison do the defending.

The rule switches added in the beta (`rules.breachDeployIntoBailey`, `rules.bailey.keepSpillover`, `rules.casualties.baileyPerMargin`, `rules.raid.guardPerBuilding`, `rules.recruitPerAction`, `rules.minimumCostAfterDiscount`) can each be turned off in `rules.json` to return to the spec's original rule.
