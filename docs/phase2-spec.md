# Phase 2 Build Specification: Mode A Rogue-Lite Battle System

**Goal:** Mode A, a full roguelite run that's playable from start to finish.

## 1. Run Structure & Progression
- **Length:** 31 floors.
  - Floors 1–10: Early monsters (T1)
  - Floors 11–20: Mid monsters (T2)
  - Floors 21–30: Late monsters (T3)
  - Floors 10, 20, 30: Boss floors (6 enemy monsters)
  - Normal floors: 3 enemy monsters
  - Floor 31: Boss encounter (1 Legend, Mega, or Gigantamax at Lv 100 with 3× HP, acting twice per turn)
- **Level Curve:** Floor entry level $L(f) = \min(100, \max(5, \text{round}(100 \cdot f / 30)))$.
  - Enemies scale to $L(f)$; boss floors add $+3$ levels. Floor 30 is Lv 100.
- **Loss / Rebattle:** Losing allows a rebattle against the same seeded enemies or ending the run without penalties.
- **Persistence & Cloud Sync:** Saves locally after every floor. Syncs to Firestore at floors 10, 20, 30, and run completion.

## 2. Starting a Run
- **Roster Selection:**
  - Choose from all 27 Gen 1–9 starters.
  - Early monsters owned in Box that can still evolve.
  - Any single-stage/fully evolved monster (including Legends) previously beaten and recruited in an earlier run.
- **Optional Extras:**
  - 1 pick from 3 random Early monsters (filtered by franchise; Pals are Early only).
  - 2 free rolls (filtered by franchise; any Pal can appear).
- **Abilities:**
  - Pokémon: select an ability from the species list.
  - Pals/Digimon: assigned a random coded ability, rerollable at run start.

## 3. Post-Battle Reward & Management Loop
- **Recruitment:** Pick 1 of 3 defeated enemies + 1 free roll from the current tier pool.
- **Run Box & Exp:** New recruits go to the active run box. All monsters in the run box share XP evenly with the team.
- **Roster Swapping:** Swap between team (6 active) and run box between battles. Change abilities anytime outside combat.
- **Permanent Collection:** Every recruit is permanently added to your main Box and flagged as beaten.

## 4. Battle Engine Rules
- **Field Layout:** 3 active and 3 bench per side. Switching consumes the monster's action turn.
- **Post-Battle State:** Full party heal after every combat victory.
- **Turn Priority:** Action priority $\rightarrow$ Speed (modified by stat stages) $\rightarrow$ Trick Room inversion.
- **Damage Formula:**
  $$\text{Damage} = P \times \frac{2A}{A+D} \times K \times \text{STAB}(1.5) \times \text{TypeMult} \times \text{Abilities/Terrain} \times \text{Crit}(1.5) \times \text{Rand}(0.85\text{--}1.0)$$
  - $A$ and $D$ use `statAt` values on the 1,000 scale. $K \approx 1.5$ (tuned by headless simulator). Max type multiplier = $4\times$.
- **Digimon Attribute Triangle:** Vaccine $\rightarrow$ Virus $\rightarrow$ Data $\rightarrow$ Vaccine ($1.5\times$ advantage, $0.75\times$ disadvantage).
- **Supported Battle Effects:** Major statuses, volatile statuses (confusion, flinch, etc.), stat stage modifiers ($\pm6$), weather, terrain, entry hazards, screens, spread moves ($0.75\times$ damage).
- **Excluded Systems:** Held items, Z-moves, Dynamax, Tera, Natures, IVs/EVs.

## 5. Moves & Skill Scaling
- **Player Moves:** Monsters can select from any move learned up to their current level, sorted by recency of use.
- **Enemy Moves:** Auto-assigned the 4 most recently learned level-up moves for their current level.
- **Palworld Moves:** Melee maps to Physical, Shot maps to Special. "Skill" moves pick the higher of Atk or SpA. By default, Pal moves deal raw damage only.

## 6. Evolution System
- **Pokémon:** Evolve by level. Stone/trade/friendship forms evolve at fixed fallback levels (Lv 12 out of baby stage, Lv 30 into stage 2, Lv 45 into stage 3). Branching evolutions choose randomly.
- **Digimon:** Target level threshold table with random branch selection.
- **Palworld:** No evolutions.
- **Ability Reroll:** Evolving triggers a random valid ability roll (can be customized outside combat).
- **Mega & Gigantamax Unlocks:** Defeating a form on Floor 31 unlocks it permanently. In future runs, monsters can transform into these forms once reaching their final evolution stage.

## 7. Monster & Move Editor (`game.overrides[key]`)
- **Scope:** Custom editing for types, stats, move type, category, power, accuracy, status effects, weather/terrain/hazards, and VFX templates.
- **Workflow:** Opens automatically for newly encountered Digimon; accessible manually anytime for Pals.
- **Data Access:** All game logic reads via `mon(key)` (merging base records with overrides).
- **Flags:** Edited monsters receive an "Edited" badge and a "Reset to original" action. Edits stay local/cloud-synced; they are **never** written back into `/data`.
- **Digimon Verification:** Enemy Digimon only spawn once verified in the editor.

## 8. Visual Effects (VFX)
- ~12 CSS animation templates triggered by move category and target, dynamically colored by type. Includes $1\times/2\times$ battle speed toggles, Auto-battle, and Repeat Last Turn.

---

## 🏁 Definition of Done (Phase 2)
A 31-floor rogue-lite run is fully playable end-to-end, featuring combat, reward selection, evolution, and progress saving back to the permanent Box.

> **Follow-up Task (F26 — Party Evolution):** Add a minor hook in `app.js` (`addXpToMember`) (~20 lines) allowing permanent party evolutions separate from the game. Executed upon completion of Phase 2.