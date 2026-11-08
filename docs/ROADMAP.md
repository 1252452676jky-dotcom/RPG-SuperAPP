# Monster Lab — Project Roadmap & Deferred Backlog

This document tracks all features, integrations, alternate battle modes, and dataset expansions deferred to future phases.

---

## 📦 Additional Datasets & Imports
- **Cyber Sleuth DigiDB Import:** Ingest raw stat and move data from *Digimon Story: Cyber Sleuth*.
- **Time Stranger Data:** Integrate monster stats and skill tables from *Digimon Story: Time Stranger*.
- **Wikimon MediaWiki Scraper:** Pull rich lore, move pools, and evolution paths directly from Wikimon.
- **Digimon TCG Integration:** Enable the self-hosted Digimon TCG card costumes (code written using Node `sharp` resize script targeting `data/digicards/`).

---

## ⚔️ Combat & Gameplay Systems
- **Mode B (Deck-Building Battle Engine):** Slay-the-Spire-style deck combat with a shared turn mana pool, skill cards drawn per turn, mana costs (0–3), and visible enemy intents.
- **Held Items & Consumables:** Implement combat-held items, berry healing, and stat-buffing items.
- **Remaining Abilities:** Code the full catalog of combat abilities beyond the initial Phase 2 pool.
- **Smarter AI & Difficulty Modes:** Implement advanced AI target selection, type-coverage prediction, switch logic, and selectable difficulty tiers.

---

## 🎨 Visuals & Audio
- **Sprite-Sheet VFX:** Replace the Phase 2 CSS animation templates with multi-frame sprite-sheet Canvas VFX (e.g., custom impact textures, elemental bursts, and projectile paths).

---

## 🔄 App Integration & PWA Infrastructure
- **Habit Integration (Phase 3):** Deep link habit completions directly to battle energy, habit XP distribution, and main Party synchronization.
- **Service Worker:** Implement a full PWA Service Worker for 100% offline access to game assets, card images, and data files.