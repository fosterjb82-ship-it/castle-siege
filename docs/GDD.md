# Castle Siege — Game Design Document (Beta Build Spec)

> **Working title:** Castle Siege (final name TBD)
> **Status:** v0.2. It adds the three-phase structure (Build → Siege → Assault) with a relief-army clock, plus food, the garrison cap and new siege engines. Everything marked *[tunable]* is a starting value to change during playtesting.
> **Build status:** the beta implements v0.2 including milestone M7: the three phases, the relief clock, food, the garrison cap, the new engines and the stratagem cards. Open numbers are in Section 20.
> **Purpose:** this document is the handoff to a Claude Code build session. It holds the full rules, data and scope needed to build a testable beta.
> **Source of truth for brainstorm history:** "Castle Siege Game — Design Doc (Working Draft)" (claude.ai Docs). This spec supersedes it where they differ.

**Legend:** **[Decided]** = chosen by the designer. **[Proposed]** = a default filled in so the beta can be built; change freely. *[tunable]* = a number expected to change.

---

## 1. Concept

A digital co-op board game with cards, set in medieval times. Players build up a castle together, and the game ends in a siege where a large enemy force attacks and the team has to hold. **[Decided]**

- The board develops as cards are played. Buildings and fortifications appear in slots on the castle map, and siege camps appear in the approaches around it. **[Decided]**
- The game has **three phases [Decided, v0.2]**:
  1. **Build:** economy, infrastructure, drafting a hidden siege deck.
  2. **Siege:** the blockade. The castle is surrounded, food dwindles, the Warlord bombards and secretly masses his troops, and a relief army marches to the rescue.
  3. **Assault:** the storming. Both sides play the siege decks they prepared.
- **Food** is the castle's lifeline. It is stored during the Build Phase and eaten during the Siege and the Assault, with nothing coming in. **[Decided]**
- A **relief army clock** stops the Warlord simply waiting the castle out. If the Keep still stands when the relief arrives, the defenders win. **[Decided]**
- Each human defender plays a **character** with unique abilities. **[Decided]**
- The **Warlord** (attacker) decides when the siege begins. **[Decided]**

---

## 2. Beta scope

### In scope for the beta
| Feature | Notes |
|---|---|
| **Co-op mode vs AI Warlord** | 1–4 human players on one device (hot-seat) split the 4 defender characters. Primary beta mode. |
| **Warlord mode (hot-seat)** | 1 human Warlord vs 1–4 human defenders on one device. A "pass the device" privacy screen hides hands and face-down plays. |
| Full Build, Siege and Assault phases | All rules in this document (the Siege phase is milestone M7) |
| One map | The standard castle (Section 4) |
| Data-driven cards, buildings, troops, map | JSON files; tuning needs no code changes |
| Game log | Every action and resolution step, readable text |
| Debug panel | Grant resources, skip to siege, reveal hidden cards, set RNG seed, export game state and log |
| Headless simulation | AI vs AI games from the command line for balance testing |

### Out of scope for the beta (later)
- **Treachery mode** (hidden traitor). It needs private messaging and online play.
- Online multiplayer, accounts, matchmaking
- Additional maps, Warlord factions, extra characters
- Final art, music, animations beyond basic card reveal
- Steam packaging and achievements

### Platform and tech **[Proposed — confirm at the start of the Claude Code session]**
- **Desktop browser first**, matching the approach used for the designer's other prototypes. Choose an engine later.
- **TypeScript + Vite.** Render the board with SVG or Canvas (React + SVG or Phaser are both fine).
- **The rules engine is pure TypeScript with no UI dependencies.** Game state is a serializable object, and actions are pure functions `(state, action) → state`. That makes save/load, undo (debug), replays, tests and headless simulation straightforward.
- **Seeded RNG** for all shuffles, so a game can be replayed from its seed and action list.
- **Unit tests** (e.g. Vitest) for setup, each action, and each siege resolution step.
- Packaging for Steam later via Electron or Tauri.

---

## 3. Modes

| Mode | Attacker | Defenders | Beta? |
|---|---|---|---|
| **Co-op** | AI Warlord | All human players | Yes (primary) |
| **Warlord** | 1 human | All other humans | Yes (hot-seat) |
| **Treachery** | 1 human | Other humans, one of whom may secretly be a traitor working for the Warlord | No — later |

- **All 4 characters are always in play [Proposed].** With fewer than 4 defender players, players split the characters (e.g. a solo player controls all four). Fixed counts make balancing simpler.
- **Defenders coordinate by talking only [Decided].** They can't see each other's face-down siege cards. In hot-seat, each player's hand is shown only on their own turn.
- **Traitor notes (for later):** private channel with the Warlord; sabotage that looks like reasonable play (spending visibly but poorly, weak placements, leaked scouting); a dramatic reveal such as opening a gate. The traitor may not exist every game.

---

## 4. The map

```
                 NORTH APPROACH  (3 Warlord slots)
        T ═══════════════ [GATE] ═══════════════ T
        ║               NORTH BAILEY            ║
        ║               (3 building slots)      ║
 WEST   ║ ┌──────────┐ ┌────────┐ ┌──────────┐  ║   EAST
 APPR. [GATE] WEST   │ │  KEEP  │ │   EAST [GATE] APPR.
 (3)    ║ │ (2 slots)│ │ (Lord) │ │ (2 slots)│  ║   (3)
        ║ └──────────┘ └────────┘ └──────────┘  ║
        ║               SOUTH BAILEY            ║
        ║               (3 building slots)      ║
        T ═══════════════ [GATE] ═══════════════ T
                 SOUTH APPROACH  (3 Warlord slots)

T = corner tower slot (covers both adjacent lanes)
```

**[Decided]:** four outer approaches (one per direction); walls with a gate at the center of each wall; tower slots on the walls; building slots inside; a central keep where the Lord stays. If attackers reach the keep and the Lord falls, the game ends.

**[Proposed] structure:**

| Zone | Count | Contents |
|---|---|---|
| Outer approach | 4 (N, S, E, W) | 3 Warlord building slots each; Warlord troops and engines stand here |
| Wall segment | 4 | Each has a **Wall** structure and a **Gate** structure (separate HP) |
| Corner tower slot | 4 (NE, NW, SE, SW) | One tower each; a tower counts for **both** adjacent lanes |
| Bailey (inner section) | 4 | North and South: 3 building slots each. East and West: 2 each. Defender troops stand here. |
| Keep | 1 | The Lord. Has its own Defense and HP. |

**Lanes:** each direction (N/S/E/W) is a lane made of: its approach → its wall and gate → its bailey → the keep.

**Adjacency:** N–E, E–S, S–W, W–N. Defender troops can move between adjacent baileys (interior lines). Warlord troops moving between adjacent approaches pay a cost (see Actions).

**Map as data [Proposed]:** define zones, slots, adjacency and starting structures in `map.standard.json` so future maps (coastal, mountain pass, river, concentric, motte-and-bailey, ruined) are mostly new data files.

---

## 5. Resources and starting state

| Side | Resources | Pool |
|---|---|---|
| Defenders | Stone, Wood, Gold, **Food** | **One shared stockpile [Decided]** |
| Warlord | Supplies, Timber, Gold | Warlord's own stockpile |

**Food (defenders) [Decided: food dwindles in the Siege and the Assault]:** produced only during the Build Phase (Keep +1, Granary +2 per Collect). From the War Horns on, no Food comes in: the fields are cut off. At the start of every Siege and Assault round the garrison eats **1 Food per 3 troops** *[tunable]*, rounded up; the Knight doesn't count. If the stores can't cover it, the garrison is **hungry** that round: **every defender troop −1 Strength** (minimum 0). **There is no starvation win [Decided]**: hunger only weakens the garrison.

**Garrison Capacity (defenders) [Decided: cap defender troops]:** a hard cap on defender troops. The Keep houses 6, a Barracks adds 3, and a Garrison Hall houses 5 in total *[tunable]*. Training stops when the castle is full, and reinforcement cards only bring in as many troops as there is room for. **Population:** the castle has 6 townsfolk *[tunable]*. Militia Levy turns them into Militia *beyond* the cap until the town runs out. More troops also means more mouths to feed.

**Supply Rating (Warlord only):** a cap on army size, separate from Supplies. Every Warlord troop on the board uses 1 Supply Rating. **If troops on the board exceed the Supply Rating, every Warlord troop gets −1 Strength** (minimum 0). Siege engines don't count.

### Starting state
| | Defenders | Warlord |
|---|---|---|
| Materials *[tunable]* | 4 Stone, 4 Wood, 3 Gold, 4 Food | 5 Supplies, 3 Timber, 4 Gold |
| Structures | **Basic walls and wooden gates on all four sides [Decided]**, plus the keep | Main Siege Camp (placed during setup) |
| Troops | 3 Militia (placed during setup) **[Decided: 3 troops]** | 3 Footmen (placed during setup) **[Decided: 3 troops]** |
| Base income per round *[tunable]* | Keep: +1 Stone, +1 Wood, +1 Gold, +1 Food (Food in the Build Phase only) | Main Siege Camp: +2 Supplies; war chest +1 Supplies, +1 Timber, +1 Gold |
| Siege deck *[tunable]* | Each character starts with 2× Hold the Line | 3× Advance |

### Starting structures *[tunable]*
| Structure | Defense | HP |
|---|---|---|
| Basic Wall (each side) | 2 | 6 |
| Wooden Gate (each side) | 1 | 4 |
| Keep | 3 | 8 |

---

## 6. Game flow overview

1. **Setup Phase** (once)
2. **Build Phase:** rounds 1…N
3. **War Horns:** the Warlord surrounds the castle. The relief clock starts.
4. **Siege Phase (blockade):** 1–4 rounds. Food dwindles, the Warlord bombards and secretly repositions, and the defenders repair, sortie and scout. It ends when the Warlord orders the Assault, or the clock forces it.
5. **Assault Phase:** the rest of the clock (3–6 rounds). Face-down siege cards, reveal, 5-step resolution.
6. **End:** the relief army arrives with the Keep standing (defenders win), or the Lord falls (Warlord wins).

```
Build ──War Horns──▶ Siege (blockade) ──Assault ordered──▶ Assault ──▶ relief arrives / Keep falls
                     └──────────── relief clock: 7 rounds ────────────┘
```

---

## 7. Setup Phase [Decided: concept] [Proposed: details]

1. Both sides receive their starting materials.
2. **Simultaneous hidden placement [Proposed]:**
    - Defenders place **3 Militia** in any baileys.
    - The Warlord places the **Main Siege Camp** in one outer approach and **3 Footmen** in any approaches.
3. Reveal all placements. Round 1 begins.

**Main Siege Camp [Proposed]:** gives its lane **+1 attack for the whole game** and **+3 Supply Rating**, and is where Siege Workshops must be built first. It signals the Warlord's intended direction but is a real commitment. It can't be destroyed in the beta.

---

## 8. Build Phase

### Round structure
1. **Collect:** all production buildings pay out (defender income to the shared stockpile, Warlord to theirs).
2. **Defender turns:** the four characters take turns **in any order the team chooses each round [Proposed]**. Each character takes **2 actions** *[tunable]*.
3. **Warlord responses:** **after each defender character's turn, the Warlord takes 1 action [Decided: Warlord acts after every defender turn]**. With 4 characters, that's 4 Warlord actions per round.
4. **End of round:** check Supply Rating. The Warlord may sound the War Horns (Section 9).

### Defender actions (2 per character turn)
| Action | Effect |
|---|---|
| **Build / Upgrade** | Pay the cost from the stockpile; place in an empty legal slot or upgrade an existing structure |
| **Draft** | Pay the deck's draw cost; draw 3 from that deck, keep 1 into **this character's** siege deck, put the other 2 on the bottom of the deck |
| **Train** | Pay a troop's cost; place it in any bailey (requirements apply) |
| **Move** | Move any number of troops from one bailey to an adjacent bailey |
| **Trade** | Swap resources at 2:1 with the bank |
| **Ability** | Use the character's build-phase ability (once per round) |
| **Raid** (Knight only) | See Raids below |

### Warlord actions (1 after each defender turn)
| Action | Effect |
|---|---|
| **Build / Upgrade** | Place in an empty slot in an outer approach |
| **Draft** | Pay draw cost; draw 3, keep 1 into the Warlord's siege deck |
| **Recruit** | Pay a troop's cost; place it in an approach containing a Siege Camp or War Camp |
| **March** | Move up to 3 troops to an adjacent approach (costs 1 Supplies) |
| **Trade** | Swap resources at 2:1 |
| **Harass** | Pay 2 Supplies: choose an approach with ≥ 3 Warlord troops; one defender production building in the matching bailey produces nothing next Collect |

### Draft decks and draw costs *[tunable]*
| Side | Deck | Draw cost | Requires |
|---|---|---|---|
| Defender | Tactics | 2 Gold | — |
| Defender | Fortifications | 2 Stone | — |
| Defender | Garrison (reinforcements) | 1 Gold, 1 Wood | Barracks |
| Warlord | Tactics | 2 Gold | — |
| Warlord | Troops (reinforcements) | 2 Supplies | War Camp |
| Warlord | Siege Engines | 2 Timber | Siege Workshop |

**Siege decks are hidden.** Each defender character has their own siege deck. The Warlord has one.

### Raids [Proposed]
- **Knight only, 1 action.** The Knight leaves through a gate with up to 2 troops from that lane's bailey into the matching approach.
- Compare **raiding party Strength** (Knight 2 + troops) against **Warlord troop Strength in that approach**.
- **Raid wins (higher):** destroy one Warlord building in that approach (defenders choose; the Main Siege Camp can't be destroyed). The Warlord loses 1 troop there.
- **Raid loses or ties:** the raiders lose 1 troop (not the Knight), and that **gate takes 2 damage** because it was left open.
- The party returns to the bailey afterward.

---

## 9. War Horns and the Siege Phase (blockade) [Decided: three phases, relief clock, no starvation win] [Proposed: details]

### War Horns
- The Warlord may sound the War Horns at the end of any Build round **from round 4 through round 8** *[tunable]*. If they haven't by the end of round 8, the horns sound automatically.
- The horns **start the Siege Phase** and the **relief clock**. The v0.1 "one final build round" is replaced by the Siege Phase: defenders still act, but under blockade.
- **Surprise Assault** (Warlord tactic, later): order the Assault right after the horns, skipping the blockade. Not in the beta.

### Relief army clock [Decided: relief army] [Proposed: numbers]
- When the horns sound, a relief army is **7 rounds away** *[tunable]*. One track counts down through both the Siege and Assault phases, one step at the end of every round.
- **The Warlord orders the Assault** at the end of any Siege round. It must leave time to storm the walls: when **3 rounds remain** *[tunable]* the Assault starts automatically. So the blockade lasts 1–4 rounds, and the Assault 3–6.
- **When the clock reaches 0, the relief army arrives.** If the Keep still stands, the defenders win.
- **The central choice:** assault early against a fed, intact castle with plenty of rounds to fight, or wait so hunger and bombardment soften it up, with fewer rounds left for the storm.
- The clock is always visible to both sides.

### Siege (blockade) round [Proposed]
1. **Collect.** The Warlord collects normally. Defender buildings inside the walls still produce Stone, Wood and Gold, but **no Food** comes in.
2. **Upkeep:** the garrison eats (Section 5). A shortfall means the garrison is hungry this round (−1 Strength, which matters for sorties).
3. **Bombardment:** Catapults and Trebuchets already emplaced fire, with the same effects as in the Assault's Ranged step. Rams, Ladders and Siege Towers wait for the Assault.
4. **Defender turns:** the team chooses the order. Each character takes **1 action** *[tunable]*. The Warlord takes 1 action after each defender turn, as in the Build Phase.
5. **End of round:** the relief clock moves 1 step. The Warlord may order the Assault.

### Defender actions in the Siege [Proposed: reuse the Build actions, 1 per character]
- All Build Phase actions remain: Build/Upgrade, Draft, Train (within the garrison cap), Move, Trade, character abilities. **No action can produce Food after the War Horns** (Decree, Trade and Requisition included): the fields are cut off.
- **Repair:** pay 1 Stone *[tunable]* to restore 2 HP to a wall, gate or tower (the Architect restores 3). Rubble (0 HP) can't be repaired. Repair is also available during the Build Phase.
- **Sortie** (Knight only; this is the Raid): it may target an emplaced engine instead of a building. A sortie also reveals the true troop count in that approach.
- **Scout:** look at the Warlord troops in one approach (see Hidden staging).
- **Levy:** turn 2 townsfolk into Militia beyond the garrison cap (as the Militia Levy card).
- The interesting trade-offs: repair or fortify? Scout or sortie? Levy more Militia, at the cost of more mouths to feed?

### Warlord actions in the Siege [Proposed]
- All Build Phase actions remain (Build, Draft, Recruit, Trade, Harass).
- **March is visible.** Secret movement needs a stratagem card (see below). Raiders still march free.
- **Play a stratagem** from your siege deck (Night March, Campfires; see below).
- **Emplace engine:** put an engine card from your siege deck onto an approach, face up. Catapults and Trebuchets start bombarding next round. Rams, Ladders and Siege Towers are ready on the first Assault round. Emplaced engines can be targeted by Sorties and by Burning Oil in the Assault.

### Deception: stratagem cards [Decided: secret movement, but only through tactics cards]
Troop positions are **visible by default**. Generals of old lit campfires in one place and moved their army by night; in this game the Warlord can do the same, but only with **stratagem cards**. These are drafted from the Warlord's Tactics deck during the Build Phase and played as an action during the Siege phase.

| Card | Effect | Copies |
|---|---|---|
| **Night March** | Secretly move up to 5 troops *[tunable]* to an adjacent approach. The defenders still see them where they were. | 2 |
| **Campfires** | One approach looks like it holds 4 more troops *[tunable]* than it does. | 2 |

- **What defenders see:** a campfire count per approach, not unit types, which stratagems can falsify. Engines and camps are always visible.
- **How the truth comes out:** **Scout** reveals one approach's true count. A **Sortie** reveals the approach it hits. **The Assault reveals every position.**
- Defenders learn only that "something stirs in the Warlord's camp", never what.
- **Cost:** drafting stratagems uses picks the Warlord could spend on engines or troops. An unused stratagem is a dead card in the Assault.
- On the table: the Warlord tracks the real positions behind a screen, with the board showing the campfires.

### Rejected for now (to keep the game simple)
- **Starvation win** (the castle surrenders): rejected. It would make waiting dominant.
- **Rationing** (eat less, fight weaker): left out. During the blockade there is little fighting, so rationing would almost always be right and wouldn't be a real decision.
- **Warlord camp upkeep / disease:** not needed while the relief clock provides the pressure.

---

## 10. Assault Phase

### Overview
- Lasts **until the relief army arrives**: whatever remains of the relief clock, 3–6 rounds (Section 9). The v0.1 fixed "5 siege rounds" is replaced by the clock.
- **The Assault begins with a reveal of all hidden Warlord troop positions.** Engines emplaced during the Siege are already in place.
- Each round starts with Collect (no Food for the defenders) and Upkeep (the garrison eats; if short, hungry: −1 Strength this round). The only other actions are playing siege cards and the steps below.
- **Hand:** at the start of the Assault, each defender character draws 3 from their siege deck and the Warlord draws 5 *[tunable]*. Refill to those sizes at the end of each round.
- **Fallback:** if a siege deck is empty, the player may play their basic card (Hold the Line / Advance) from an unlimited supply.

### Assault round
1. **Collect and Upkeep.**
2. **Move (hidden):** defenders may reposition troops between adjacent baileys; the Knight may move to any bailey. The Warlord may move troops into a breached bailey from its approach. Planned moves are revealed in step 4.
3. **Plan:** cards are placed **face down** onto lanes (N/S/E/W) **[Decided]**:
    - **Each defender character plays 1 card [Decided: one per human player; Proposed: one per character].**
    - **The Warlord plays 3 cards** *[tunable; Proposed formula: number of defender characters − 1, minimum 2]*.
    - In hot-seat, a privacy screen hands the device to each player in turn.
4. **Reveal:** all cards and moves flip at once **[Decided]**.
5. **Resolve** in this fixed order (each card has a **speed icon** saying which step it uses) **[Proposed order]**:
    1. **Scouting and tricks:** Spy, Scout Report, Decoy, and similar
    2. **Ranged:** towers, archers, crossbows, Burning Oil, Volley, Trebuchet
    3. **Siege engines:** engines attack their target structures
    4. **Melee clash:** per lane (below)
    5. **Recovery:** repairs, rallies
6. **Refill** hands. Check victory.

### Lane combat [Proposed]
For each lane, after steps 1–3:

- **Attack total** = Strength of Warlord troops in that approach (or bailey, if breached) + attack bonuses from cards and buildings played or standing there.
- **Defense total** = Strength of defender troops in that lane's bailey + the structure's Defense + towers covering the lane + defense bonuses from cards.
- **Each Warlord attack card and engine names a target:** **Gate** or **Wall** [Decided: Rams hit gates; Ladders and Siege Towers hit walls]. Troops with no stated target attack the **Gate** by default [Proposed].
- Compute separately for each targeted structure:
  `damage = max(0, attack on that target − (that structure's Defense + lane defense bonuses + defender troop Strength))`
- Apply damage to that structure's HP.
- **Casualties:** in each lane where both sides have troops, compare the lane's full attack total with its defense total. The side with the lower total loses its weakest troop. Ties: no casualties.
- **Breach:** when a lane's Wall **or** Gate reaches 0 HP, that lane is **breached**. From the next round, Warlord troops may move into that bailey (step 2).

### Fighting inside the walls [Proposed]
- In a breached bailey, the clash is **Warlord troops in the bailey vs. defender troops there** (no structure Defense).
- If the Warlord wins a bailey clash by 2 or more, **one building in that bailey is destroyed** (defenders choose which).
- If a breached bailey holds Warlord troops and **no defender troops** at the start of a round, those troops attack the **Keep** that round: `damage = max(0, attack − Keep Defense − bonuses)`.

### Victory [Decided: Lord falls = Warlord wins] [Proposed: other conditions]
- **Warlord wins** immediately when the Keep reaches 0 HP (the Lord falls).
- **Defenders win** when the relief army arrives (the clock reaches 0) and the Keep still stands. **[Decided: relief army]**
- **No starvation win [Decided]:** an empty larder only means hunger (−1 Strength), never surrender.
- **Defenders also win** immediately if, during the Assault, the Warlord has no troops on the board and no troop cards in hand or deck. *[Proposed; under review: the beta simulation showed it ends many games early]*

---

## 11. Characters [Decided: the four roles] [Proposed: exact abilities]

Build-phase abilities also apply during the Siege (blockade) phase. "Siege ability" means the Assault Phase.

| Character | Build-phase ability (once per round) | Passive | Siege ability |
|---|---|---|---|
| **Lord** | **Decree** (action): gain 2 of any one resource | — | Stays in the Keep. **Rally:** once per Assault round, in Recovery, +2 Defense to one lane next round. If the Lord falls, defenders lose. |
| **Architect** | — | Walls, gates and towers cost 1 less Stone | **Repair:** once per Assault round, in Recovery, restore 2 HP to one wall or gate |
| **Quartermaster** (logistics) | **Requisition** (action): trade up to 3 resources at 1:1 | Each Market produces +1 Gold | **Resupply:** once per Assault round, one lane's ranged effects get +1 damage |
| **Knight** | **Raid** (exclusive action) | Training troops costs 1 less Gold | The Knight is a unit (Strength 2, HP 3) that can move to any bailey each round. If defeated, it returns to the Keep after 1 round. |

**Design rule [Decided]:** no "boss" player. The Lord has unique powers, not authority over others. Each character draws from the shared decks, but the cards they keep shape their own siege deck.

**Warlord types (later):** Siege Master (engines), Raider Chief (fast troops), Mercenary Captain (gold-based).

---

## 12. Buildings

### Defender buildings *[costs tunable]*
| ID | Building | Slot | Cost | Effect | Upgrades to |
|---|---|---|---|---|---|
| quarry | Quarry | Bailey | 2 Wood | +2 Stone per Collect | — |
| lumber_mill | Lumber Mill | Bailey | 2 Gold | +2 Wood per Collect | — |
| market | Market | Bailey | 2 Wood, 1 Stone | +2 Gold per Collect | — |
| granary | Granary | Bailey | 2 Wood | +2 Food per Collect (Build Phase only) | — |
| barracks | Barracks | Bailey | 2 Wood, 2 Gold | Garrison Capacity +3; unlocks Garrison deck and Men-at-arms and Archers | Garrison Hall |
| garrison_hall | Garrison Hall | (upgrade) | 3 Stone, 2 Gold | All defender troops +1 Strength; unlocks Knights of the Keep | — |
| weaponsmith | Weaponsmith | Bailey | 2 Stone, 2 Gold | Choose one troop type at build time: +1 Strength | — |
| arrow_tower | Arrow Tower | Corner tower slot | 2 Stone, 1 Wood | +1 Defense to both adjacent lanes; Ranged: 1 damage to one attacking troop in each adjacent lane | Stone Tower |
| stone_tower | Stone Tower | (upgrade) | 3 Stone | +2 Defense to both adjacent lanes; Ranged: 1 damage ×2 | — |
| stone_wall | Fortified Stone Wall | Wall (upgrade of Basic Wall) | 3 Stone | Wall Defense 4, HP 10; Rams deal −1 damage | — |
| ironbound_gate | Iron-bound Gate | Gate (upgrade of Wooden Gate) | 2 Stone, 2 Gold | Gate Defense 2, HP 6 | Gatehouse |
| gatehouse | Gatehouse | (upgrade) | 3 Stone, 1 Wood | Gate Defense 3, HP 8; Murder Holes: Ranged 1 damage to a troop attacking this gate | Barbican (later) |
| moat | Moat | Lane (one per lane) | 3 Gold | Rams and Siege Towers can't attack this lane unless a Bridge is played | — |

### Warlord buildings *[costs tunable]*
| ID | Building | Cost | Effect | Upgrades to |
|---|---|---|---|---|
| main_siege_camp | Main Siege Camp | Free (setup) | +2 Supplies per Collect; +3 Supply Rating; its lane +1 attack | — |
| siege_camp | Siege Camp | 3 Supplies | +2 Supply Rating; troops recruited here cost 1 less Supplies | — |
| supply_line | Supply Line | 2 Gold | +2 Supplies per Collect; +1 Supply Rating; can be raided | — |
| foraging_camp | Foraging Camp | 1 Supplies | +1 Supplies, +1 Timber per Collect | — |
| war_camp | War Camp | 2 Supplies, 2 Gold | Unlocks Troop deck, Raiders and Crossbowmen | Veteran Camp |
| veteran_camp | Veteran Camp | 3 Supplies, 2 Gold | Unlocks Veterans | — |
| siege_workshop | Siege Workshop | 3 Timber | Unlocks Siege Engine deck (first one must be in the Main Siege Camp's approach) | — |
| staging_ground | Staging Ground | 2 Supplies | Its lane +1 attack; visible to defenders (feint potential) | — |
| command_tent | Command Tent | 2 Gold | Warlord hand size +1 in the siege | — |

---

## 13. Troops *[stats tunable]*

Board troops are the standing army trained during the Build Phase. Troop cards in siege decks deploy more troops during the siege.

| ID | Side | Troop | Strength | HP | Cost | Requires | Notes |
|---|---|---|---|---|---|---|---|
| militia | Defender | Militia | 1 | 1 | 1 Gold | — | Starting troop |
| archers | Defender | Archers | 1 | 1 | 2 Gold | Barracks | Ranged: 1 damage to an attacking troop |
| men_at_arms | Defender | Men-at-arms | 2 | 2 | 2 Gold, 1 Wood | Barracks | — |
| keep_knights | Defender | Knights of the Keep | 3 | 2 | 3 Gold, 1 Stone | Garrison Hall | — |
| footmen | Warlord | Footmen | 1 | 1 | 1 Supplies | — | Starting troop |
| raiders | Warlord | Raiders | 2 | 1 | 2 Supplies | War Camp | March costs nothing for Raiders |
| crossbowmen | Warlord | Crossbowmen | 1 | 1 | 2 Supplies, 1 Gold | War Camp | Ranged: 1 damage to a defender troop |
| veterans | Warlord | Veterans | 3 | 2 | 3 Supplies, 1 Gold | Veteran Camp | — |

**Damage to troops:** ranged damage reduces HP; a troop at 0 HP is removed. Clash casualties remove the weakest troop outright.

---

## 14. Siege cards

**Card fields:** `id, name, side, deck, speed (scout|ranged|engine|melee|recovery), laneRule (any|N|S|E|W|none), target (gate|wall|any|troops|none), effect, copies`.

**Directional cards [Decided concept]:** a card tied to one lane (e.g. "Northern Assault") is stronger than a generic one but announces its lane when scouted. That adds bluffing.

### Defender — Tactics deck
| Card | Speed | Effect | Copies |
|---|---|---|---|
| Hold the Line | melee | +1 Defense in this lane (basic, unlimited fallback) | starter |
| Northern / Southern / Eastern / Western Defense | melee | +3 Defense, only in the named lane | 2 each |
| Shield Wall | melee | +2 Defense in this lane | 3 |
| Scout Report | scout | Look at 1 random card in the Warlord's hand | 3 |
| Counter-Feint | scout | If no Warlord card was played in this lane, draw 2 cards | 2 |
| Sally Forth (Knight only) | melee | The Knight and troops in this bailey attack the approach: compare Strength, loser loses its weakest troop | 2 |

### Defender — Fortifications deck
| Card | Speed | Effect | Copies |
|---|---|---|---|
| Burning Oil | ranged | Destroy one siege engine attacking this lane | 3 |
| Barricade | melee | +2 Defense in this lane; the gate gets +2 temporary HP this round | 3 |
| Caltrops | ranged | Warlord troops in this lane −1 Strength this round | 3 |
| Emergency Repairs | recovery | Restore 3 HP to this lane's wall or gate | 3 |
| Murder Holes | ranged | 2 damage to troops attacking this lane's gate | 2 |

### Defender — Garrison deck
| Card | Speed | Effect | Copies |
|---|---|---|---|
| Militia Levy | melee | Deploy 2 Militia in this bailey | 3 |
| Archer Company | ranged | Deploy 2 Archers in this bailey (they fire this round) | 3 |
| Men-at-arms Detachment | melee | Deploy 1 Men-at-arms in this bailey | 3 |
| Knights of the Keep | melee | Deploy 1 Knights of the Keep (requires Garrison Hall) | 2 |

### Warlord — Tactics deck
| Card | Speed | Effect | Copies |
|---|---|---|---|
| Advance | melee | +1 attack in this lane (basic, unlimited fallback) | starter |
| Northern / Southern / Eastern / Western Assault | melee | +3 attack, only in the named lane | 2 each |
| Decoy Banners | scout | Does nothing; looks like an attack card if scouted **[Decided]** | 3 |
| Spy in the Walls | scout | Look at 1 card in a chosen defender's hand **[Decided]** | 3 |
| Volley | ranged | 2 damage to defender troops in this lane | 3 |
| Sappers | engine | 2 damage to this lane's wall, ignoring Defense | 2 |
| Bribe the Guard | melee | This lane's gate −2 Defense this round | 2 |
| Bridge | scout | Engines ignore this lane's moat this round **[Decided concept]** | 2 |
| Night March | (Siege) | Stratagem: secretly move up to 5 troops to an adjacent approach (Section 9) **[Decided concept]** | 2 |
| Campfires | (Siege) | Stratagem: one approach looks like it holds 4 more troops (Section 9) **[Decided concept]** | 2 |

### Warlord — Troops deck
| Card | Speed | Effect | Copies |
|---|---|---|---|
| Footmen Wave | melee | Deploy 3 Footmen in this approach | 3 |
| Raider Band | melee | Deploy 2 Raiders | 3 |
| Crossbow Line | ranged | Deploy 2 Crossbowmen (they fire this round) | 3 |
| Veteran Company | melee | Deploy 1 Veterans (requires Veteran Camp) | 2 |

### Warlord — Siege Engines deck
Engines stay on the board until destroyed and attack every round.

| Card | Speed | Target | Attack | HP | Notes | Copies |
|---|---|---|---|---|---|---|
| Battering Ram | engine | Gate | 3 | 3 | Ignores up to 2 of the gate's Defense, so it can break a Gatehouse. Blocked by moat **[Decided: rams hit gates]** | 3 |
| Ladders | engine | Wall | 2 | — | One use **[Decided: ladders hit walls]** | 3 |
| Siege Tower | engine | Wall | 3 | 4 | Shelters up to 4 troops in its approach from ranged fire **[Decided: siege towers protect troops]**. Blocked by moat (the shelter still works) | 2 |
| Trebuchet | ranged | Wall or tower | 2 | 3 | Ignores moat; can damage towers | 2 |
| Catapult | ranged | Tower (wall if none) | 2 vs towers / 1 vs wall | 3 | Ignores moat; bombards the towers covering its lane **[Decided: catapults attack towers]** | 3 |

During the Siege (blockade) phase, engines are **emplaced** as a Warlord action. Catapults and Trebuchets bombard every Siege round; the others wait for the Assault.

---

## 15. Co-op AI Warlord [Proposed]

Simple, rule-based, seeded. It should be beatable but threatening.

- **Setup:** place the Main Siege Camp in a random approach (weighted toward lanes without starting defender troops). Spread Footmen 2/1.
- **Build rounds 1–3:** prioritize economy (Supply Line, Foraging Camp), then War Camp and Siege Workshop. Recruit to keep troops ≤ Supply Rating.
- **Build rounds 4+:** draft heavily (engines and directional assaults for the target lane). Choose the **target lane** = the lane with the lowest (structure Defense + troops + towers), with the main camp's lane as a tiebreaker.
- **War Horns:** sound when army Strength ≥ (total defender Strength + 6) *[tunable]*, or by round 6 (the beta's tuned value), or at round 8.
- **Siege (blockade):** emplace Catapults where towers cover the target lane, then a Trebuchet. Night March the army into the target lane and light Campfires on a decoy lane. Recruit, harass Granaries, and bring up Rams and Siege Towers.
- **When to order the Assault [Proposed]:** when the defenders are hungry, the target lane's towers are down, or its wall or gate is below half HP. In any case after at most 2 Siege rounds (`ai.maxBlockadeRounds`), since waiting shortens the Assault.
- **Siege plays:** 2 cards on the target lane, 1 feint (Decoy or a weak card) on another lane. Switch target if a different lane gets breached.
- **Difficulty:** Easy / Normal / Hard scale the Warlord's income (×0.75 / ×1 / ×1.25) *[tunable]*.

---

## 16. Balance notes

- **Turn structure first, numbers later [Decided].** Lock the turn structure early; card values are easy to patch.
- **Stronger Warlord cards [Decided lean]:** the Warlord plays fewer cards, so its cards hit harder (+3 directional vs. +2 generic).
- **Small interleaved Warlord turns:** 1 action after each defender turn.
- **The attack timing window** is a key balance lever.
- **Relief clock:** its length and the forced-Assault point decide how long the blockade can run. They are the main levers for the Siege phase.
- **Food:** starting Food, Granary output and troops per Food set how hard waiting bites.
- **Other levers:** Warlord income scaling, deck draw costs, structure HP, relief clock length, Warlord cards per round.
- **Simulation:** the headless runner plays AI vs. AI games and reports win rate, average siege round of the breach, most-picked cards and most-breached lane. Target win rate for co-op on Normal: about 50–60% for defenders *[tunable]*.

---

## 17. UI and screens [Proposed]

1. **Main menu:** New Game (mode, number of human players, assign characters to players, difficulty, seed), Continue, Debug Sandbox.
2. **Board view (main screen):** the castle map with all zones, slots, structures (with HP), troops and engines. Click a slot to see legal builds.
3. **Side panels:** shared stockpile and income preview; Warlord resources and Supply Rating; current character, actions left and available actions; that character's hand / siege deck count.
4. **Turn order picker:** at the start of each build round, defenders choose who goes next.
5. **Draft modal:** show 3 drawn cards, pick 1.
6. **War Horns banner:** a clear moment when the siege is announced.
6a. **Relief clock:** always visible, with the forced-Assault point marked, plus a Food gauge showing rounds of food left at current upkeep.
6b. **Siege (blockade) panel:** one action per character; Scout, Sortie and Levy; the Warlord's hidden March and Emplace engine. Approaches show "? troops" to defenders until scouted or revealed.
6c. **Assault banner:** troop positions revealed with a sweep across the board.
7. **Siege planning:** privacy screen "Pass to [Character]" in hot-seat; drag a card onto a lane face down.
8. **Reveal and resolution:** flip all cards together, then step through the 5 resolution steps with highlights and log lines. A "next step" button, plus an auto-play option.
9. **Game log:** scrollable, every action and result.
10. **End screen:** winner, summary (rounds, breaches, cards played), export log.
11. **Debug panel (toggle):** add resources, jump to War Horns, reveal hidden info, set seed, export/import state JSON.

**Visual style:** final art TBD. Use readable placeholder art and clean, high-res text in the beta.

---

## 18. Data files [Proposed]

```
/data
  map.standard.json      zones, slots, adjacency, starting structures
  buildings.json         defender and Warlord buildings
  troops.json            troop stats
  cards.defender.json    Tactics, Fortifications, Garrison
  cards.warlord.json     Tactics, Troops, Siege Engines
  characters.json        abilities and passives
  rules.json             tunables: starting resources, income, actions per turn,
                         war-horn window, siege rounds, hand sizes, Warlord cards per round,
                         trade rate, AI difficulty multipliers,
                         relief clock length and forced-Assault point, food upkeep,
                         garrison capacity and population
```

Example card record:
```json
{
  "id": "northern_assault",
  "name": "Northern Assault",
  "side": "warlord",
  "deck": "tactics",
  "speed": "melee",
  "laneRule": "N",
  "target": "any",
  "effect": { "type": "attackBonus", "amount": 3 },
  "copies": 2,
  "text": "+3 attack, only in the North lane."
}
```

Effects should use a small set of typed effect handlers (`attackBonus`, `defenseBonus`, `damageStructure`, `damageTroops`, `destroyEngine`, `deployTroops`, `repair`, `peekHand`, `drawCards`, `ignoreMoat`, `decoy`, …) rather than code per card.

---

## 19. Build milestones [Proposed]

| # | Milestone | Done when |
|---|---|---|
| M1 | Rules engine core | State model, setup, build actions, Collect, seeded RNG, data loading; unit tests pass |
| M2 | Build Phase UI | Board renders from map data; players can take every build action; log works |
| M3 | Siege Phase | Planning, reveal, 5-step resolution, breaches, keep, victory; unit tests for each step |
| M4 | AI Warlord + co-op loop | A full co-op game can be played start to finish vs AI |
| M5 | Hot-seat Warlord mode | Privacy screens; a full human-vs-human game works |
| M6 | Playtest tools | Debug panel, save/load, log export, headless AI-vs-AI simulation with summary stats |
| M7 ✅ | Three phases (v0.2) | Siege (blockade) phase, relief clock, stratagem cards (Night March, Campfires), Repair/Scout/Sortie/Levy/Emplace actions, Assault phase on the clock; AI Warlord decides when to assault; sim reports blockade length, hunger and stratagems |

**Beta definition:** M1–M6 complete, and a full co-op game takes about 45–75 minutes *[tunable target]*.

---

## 20. Open questions

- [ ] Final game title
- [ ] Engine and stack confirmation (desktop browser prototype assumed)
- [ ] Build round count and the War Horns window (4–8 assumed)
- [x] ~~Siege round count (5 assumed)~~: replaced by the relief clock (7 rounds after the horns, Assault forced at 3 left)
- [ ] Relief clock length and forced-Assault point (7 / 3 assumed)
- [ ] Siege (blockade) phase: 1 action per character, or 2?
- [ ] Should defender buildings keep producing Stone/Wood/Gold under blockade, or does all income stop?
- [ ] Keep or drop the "Warlord has no troops left" instant win?
- [ ] Rationing: worth adding later if hunger needs a decision attached?
- [ ] Lane combat formula and casualty rule (Section 10 is a first pass)
- [ ] Should the unkept draft cards go to a shared face-up row in co-op?
- [ ] Barbican upgrade (adds tower slots beside a gate) — later or in the beta?
- [x] ~~Does a breach give the Warlord a bonus against the keep?~~: beta answer: yes, a big bailey win carries through to the Keep (see `docs/RULES-NOTES.md`)
- [ ] Every card cost and number, to be set through playtesting

## 21. Future expansions
- **New castle maps:** coastal fortress (naval attacks, harbor supplies), mountain pass keep (two approaches, cliffs), river castle (bridges), concentric castle (two wall rings), motte-and-bailey (small starter / tutorial), ruined fortress (start damaged).
- New Warlord factions and defender characters.
- Treachery mode with online play.
