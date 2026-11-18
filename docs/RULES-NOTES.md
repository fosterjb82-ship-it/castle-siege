# Rules notes: how the beta implements the GDD

The spec (`docs/GDD.md`, v0.1) leaves some details open. This file lists every place where the build had to **interpret** a rule, and every place where it **changed** a rule (marked **[Beta change]**). Every number involved is in `/data` and can be tuned without code changes.

## Stack (GDD §2, "Proposed — confirm")
- TypeScript + Vite + React, board drawn in SVG. Desktop browser first.
- The rules engine (`src/engine`) is pure TypeScript with no UI imports. State is a plain JSON object. `applyAction(state, action) → newState` is pure and throws `GameError` on an illegal action.
- All randomness uses a seeded RNG stored in the state (`state.rng`). The same seed and the same actions give the same game, including AI choices.

## Setup (§7)
- **The Knight's starting bailey is chosen during setup.** The spec has no rule for where the Knight starts. (Internally the Knight can also be "in the Keep", e.g. after recovering.)
- The AI Warlord places its Main Siege Camp in a random approach. The spec says "weighted toward lanes without starting defender troops", but defender placement is hidden at that moment, so following it would mean cheating.

## Build Phase (§8)
- Character passives apply **when that character takes the action**. The Architect's −1 Stone works when the Architect builds; the Knight's −1 Gold works when the Knight trains. This gives each character a reason to take certain actions.
- **[Beta change] A discount can't make a cost free** (`rules.minimumCostAfterDiscount: 1`). Otherwise the Knight trains Militia for nothing.
- Upgrades count as the building they replaced: a Garrison Hall is a Barracks, a Veteran Camp is a War Camp, and so on. Upgrading a wall, gate or tower keeps its damage.
- Weaponsmith: you choose the troop type when you build it. Several Weaponsmiths for the same type stack.
- Towers have HP (Arrow 4, Stone 6), so Trebuchets can target them.
- Drafting: the cost is paid when you draft, and the action is spent when you pick. Others see that you drafted, but the card you kept is logged privately.
- Decree, Requisition and Raid are each once per round, as the "ability (once per round)" column says.
- **Raid:**
  - **[Beta change] Camp guards.** Each Warlord building in the raided approach adds `rules.raid.guardPerBuilding` (2) to the defending Strength. In simulation, unguarded raids won 846–0 and wrecked the Warlord's economy.
  - A failed raid damages the gate but can't take it below 1 HP during the Build Phase, so a castle can't start the siege already breached.
- **[Beta change] Recruit up to 3 troops per action** (`rules.recruitPerAction`). This partly offsets the Warlord having 4 actions per round to the defenders' 8.
- **[Beta change] The Warlord has base income** (`rules.baseIncome.warlord`: +1 Supplies, +1 Timber, +1 Gold). In the spec the Warlord has no source of Gold or Timber except Foraging Camps, yet Gold pays for Supply Lines, War Camps, Tactics drafts and Command Tents.
- The over-supply penalty (−1 Strength to every Warlord troop) is computed live, any time troops exceed the Supply Rating, including troops deployed during the siege.

## Garrison Capacity and Population (added after the beta build)
- **[Beta change] Defender troops are capped by Garrison Capacity**, mirroring the Warlord's Supply Rating. A castle under siege can strengthen its defenses but can't grow its army much.
  - The Keep houses `rules.garrison.baseCapacity` (6) troops. A Barracks adds 3 (`garrisonCapacity` in `buildings.json`); a Garrison Hall replaces that with 5. The Knight doesn't count.
  - Unlike Supply Rating this is a **hard cap**: Train is refused when the garrison is full.
  - During the siege, Men-at-arms Detachment, Archer Company and Knights of the Keep deploy only as many troops as there is room for. The rest don't arrive.
- **[Beta change] Population: the townsfolk.** The castle starts with `rules.garrison.startingPopulation` (6). **Militia Levy** turns townsfolk into Militia, using Population instead of capacity, so a levy can push the garrison over the cap. Once the town has no able-bodied folk left, levies raise nothing. Population doesn't grow.
- Troops already over the cap (from levies) stay; you just can't train more until losses bring the count under the cap.

## War Horns (§9)
- The AI also sounds the horns by round `rules.ai.hornsByRound` (6). The spec's trigger (army Strength ≥ defender Strength + 6) almost never fires, because defenders out-build the Warlord.

## Siege Phase (§10)
- **Lanes under attack.** This is an interpretation of "attacking troop". A lane is under attack in a round if the Warlord played at least one card there, has an engine there, or has troops inside its bailey. Only troops in lanes under attack:
  - assault the walls,
  - take ranged fire (towers, archers, murder holes),
  - fire their own crossbows.

  Without this rule, towers shot every Warlord troop on the map each round, and the whole army died in the first Ranged step. Feints now matter, because a feint card exposes that lane's troops.
- An assault needs Warlord troops in that approach. Attack cards in a lane with no troops do nothing.
- **Assault target:** troops attack the Gate unless the strongest attack card played in that lane targets the Wall. Cards with `target: any` (such as Advance and the Assaults) choose gate or wall when played.
- **Engines (step 3):** damage = max(0, total engine attack on that structure − (the structure's Defense − the best `defensePierce` among those engines)). Defender troops and card bonuses don't reduce engine damage; troops can't stop a ram. Rams deal −1 in a lane with a Fortified Stone Wall (the data's `ramReduction`). Ladders are used up after one attack. Trebuchets fire in the Ranged step, ignore Defense and moats, and can target a tower that covers the lane.
- **Ranged damage** is dealt one point at a time, each to the enemy most likely to fall (lowest HP, then strongest). All ranged fire in a step is simultaneous: troops killed in that step still fire.
- Quartermaster Resupply gives +1 damage to **each** defender ranged effect in that lane: each tower, the archer group, murder holes and ranged cards.
- Troop cards deploy at their own speed. Archer Company and Crossbow Line deploy in the Ranged step and fire that round; the others deploy at Melee.
- Bribe the Guard (−2 gate Defense) lasts the whole round, so it also helps engines.
- Barricade's temporary gate HP absorbs damage first and expires at the end of the round.
- Repairs can't restore a structure at 0 HP. A breach is permanent.
- Emergency Repairs targets the gate or wall you choose; by default, the more damaged one.
- Basic fallback cards (Hold the Line / Advance) can be played once your siege-deck draw pile is empty.
- Counter-Feint draws from the player's own siege deck.
- Scout Report and Spy in the Walls show one random card from the target's hand. A Decoy Banners card shows as "Advance".
- A defeated Knight sits out the next round, then returns to the Keep at full HP.
- Sally Forth only works if the Knight is in that bailey when Melee resolves.

## Siege engines (§14, extended after the beta build)
- **[Beta change] Battering Ram pierces gates.** It ignores up to 2 of the gate's Defense (`defensePierce: 2`), so 3 damage to a Wooden or Iron-bound Gate and 2 to a Gatehouse. Before this, a Gatehouse (Defense 3) made a lone ram useless. It is still blocked by a moat unless a Bridge is played. Several rams pool their attack and use the highest pierce.
- **[Beta change] Siege Tower shelters troops.** While a Siege Tower stands in a lane, up to 4 Warlord troops in that approach (`shelter: 4`; the strongest troops first) can't be targeted by defender ranged fire: towers, archers, murder holes, and the Murder Holes card. Sheltered crossbowmen still shoot. Melee casualties are unaffected. The shelter works even when a moat stops the tower from attacking the wall. Several Siege Towers add their capacity together.
- **[New card] Catapult** (Siege Engines deck, 3 copies, ranged speed, ignores moats). Every round it deals 2 damage to a tower covering its lane, focusing on the most damaged one and ignoring Defense. A tower at 0 HP collapses and its slot empties. With no tower in range it deals 1 damage to the wall. When played, the Warlord picks the tower or the wall as its target.
- The Trebuchet stays the wall breaker (2 to the wall) and can still be aimed at a tower. Both ranged engines use the same rules (`ranged`, `canHitTowers`, `towerAttack` in the card data).

## Fighting inside the walls (§10)
- **[Beta change] Bailey fights are bloody.** The loser of a fight inside a breached bailey loses 1 troop per `rules.casualties.baileyPerMargin` (3) points of margin, minimum 1. Assaults on the walls still cost at most 1 troop, since the walls protect the defenders.
- **[Beta change, answering the GDD open question "Does a breach give the Warlord a bonus against the keep?"]** When the Warlord wins a bailey fight, the margin beyond the Keep's Defense carries through to the Keep as damage (`rules.bailey.keepSpillover`).
- **[Beta change] Troop cards played in a breached lane deploy straight into the bailey** (`rules.breachDeployIntoBailey`). Otherwise reinforcements land in the approach, wait a round, and get shot on the way in.
- The "empty bailey → attack the Keep" check happens in the Melee step, after this round's deployments.

## Victory (§10)
- Checked after every resolution step. The Keep at 0 HP → the Warlord wins at once. No Warlord troops on the board and no troop cards in hand or deck → the defenders win at once. The Keep standing after the last siege round → the defenders win.

## Not in the beta
- Treachery mode, Surprise Assault, the Barbican, extra maps and factions (all out of scope in the GDD).
- Unkept draft cards go to the bottom of the deck. A shared face-up row (GDD open question) is not implemented.
