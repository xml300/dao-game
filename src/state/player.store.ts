import { create } from "zustand";
import {
  IPlayerCoreStats,
  CultivationRealm,
  ISoulAspects,
  IDaoProgress,
  TechniqueID,
  ItemID,
  FactionID,
  QuestID,
  DaoType,
  SoulAspectType,
} from "@/types"; // Using alias if configured
import { calculateMaxStats, getNextRealm, getRealmConfig } from "@/config/realms";
import { calculateAspectEnhancementCost, DAO_UNLOCK_THRESHOLDS, DaoTechniqueUnlocks, MAX_DAO_COMPREHENSION, TRIBULATION_SCENE_KEY } from "@/config/progression";

// Interface combining all player-related state managed by Zustand
export interface PlayerState {
  coreStats: IPlayerCoreStats;
  realm: CultivationRealm;
  realmProgress: number;
  realmProgressMax: number; // TDD 5.1.1
  soulAspects: ISoulAspects;
  daoProgress: IDaoProgress;
  learnedTechniques: Set<TechniqueID>;
  activeTechniques: (TechniqueID | null)[]; // Example: array for slots
  inventory: Map<ItemID, number>;
  equipment: { [slot: string]: ItemID | null };
  factionReputation: Map<FactionID, number>;
  activeQuests: Map<QuestID, any>; // Define QuestProgress type later (TDD 7.6.1)
  completedQuests: Set<QuestID>;
  isBreakthroughReady: boolean;

  // --- Actions ---
  setActiveTechnique: (
    slotIndex: number,
    techniqueId: TechniqueID | null
  ) => void;
  setCoreStats: (stats: Partial<IPlayerCoreStats>) => void;
  takeDamage: (amount: number) => void;
  consumeQi: (amount: number) => boolean; // Returns true if successful
  consumeStamina: (amount: number) => boolean;
  advanceRealm: (newRealm: CultivationRealm) => void;
  attemptBreakthrough: (scene: Phaser.Scene) => void;
  learnTechnique: (id: TechniqueID) => void;
  addRealmProgress: (amount: number) => void;
  recalculateStats: () => void;
  enhanceSoulAspect: (aspectType: SoulAspectType) => boolean;
  discoverDao: (daoType: DaoType) => void;
  increaseDaoComprehension: (daoType: DaoType, amount: number) => void;
  // ... other actions as needed based on TDD (increaseQi, completeQuest, etc.)
}

// Calculate initial state based on starting realm config
const initialRealm = CultivationRealm.QiCondensation;
const initialAspects = { resilience: 1, perception: 1, affinity: 1, purity: 1 };
const initialRealmConfig = getRealmConfig(initialRealm);
const initialMaxStats = calculateMaxStats(initialRealm, initialAspects);

export const usePlayerStore = create<PlayerState>((set, get) => ({
  coreStats: {
    health: {
      current: initialMaxStats.maxHealth,
      max: initialMaxStats.maxHealth,
    }, // Initial values
    qi: { current: initialMaxStats.maxQi, max: initialMaxStats.maxQi },
    stamina: {
      current: initialMaxStats.maxStamina,
      max: initialMaxStats.maxStamina,
    },
  },
  realm: initialRealm, // Starting realm
  realmProgressMax: initialRealmConfig?.progressMax ?? 100, // Use config value
  isBreakthroughReady: false, // Start not ready
  soulAspects: initialAspects,
  realmProgress: 0,  
  daoProgress: {
    comprehension: new Map(),
    discovered: new Set(),
  },
  learnedTechniques: new Set(["tech_fireball"]),
  activeTechniques: ["tech_fireball", null, null, null], // Example: 4 active slots
  inventory: new Map(),
  equipment: { weapon: null, armor: null, accessory: null }, // Example slots
  factionReputation: new Map(),
  activeQuests: new Map(),
  completedQuests: new Set(),

  // --- Actions Implementation ---
  setCoreStats: (statsUpdate) =>
    set((state) => ({
      coreStats: { ...state.coreStats, ...statsUpdate },
    })),

  takeDamage: (amount) =>
    set((state) => {
      const newHealth = Math.max(0, state.coreStats.health.current - amount);
      // Potentially clamp to max health if healing involved later
      return {
        coreStats: {
          ...state.coreStats,
          health: { ...state.coreStats.health, current: newHealth },
        },
      };
    }),

  consumeQi: (amount) => {
    const currentQi = get().coreStats.qi.current;
    if (currentQi >= amount) {
      set((state) => ({
        coreStats: {
          ...state.coreStats,
          qi: { ...state.coreStats.qi, current: currentQi - amount },
        },
      }));
      return true;
    }
    return false;
  },

  consumeStamina: (amount) => {
    const currentStamina = get().coreStats.stamina.current;
    if (currentStamina >= amount) {
      set((state) => ({
        coreStats: {
          ...state.coreStats,
          stamina: {
            ...state.coreStats.stamina,
            current: currentStamina - amount,
          },
        },
      }));
      return true;
    }
    return false;
  },

  learnTechnique: (id) =>
    set((state) => ({
      learnedTechniques: new Set(state.learnedTechniques).add(id),
    })),

  setActiveTechnique: (slotIndex, techniqueId) =>
    set((state) => {
      if (slotIndex < 0 || slotIndex >= state.activeTechniques.length)
        return {}; // Invalid slot
      if (techniqueId && !state.learnedTechniques.has(techniqueId)) return {}; // Trying to equip unlearned technique

      const newActiveTechniques = [...state.activeTechniques];
      newActiveTechniques[slotIndex] = techniqueId;
      return { activeTechniques: newActiveTechniques };
    }),
  addRealmProgress: (amount) =>
    set((state) => {
      if (
        state.realm === CultivationRealm.ImmortalAscension ||
        state.isBreakthroughReady
      ) {
        return {}; // Can't gain progress at max realm or when ready for breakthrough
      }
      const currentMax = state.realmProgressMax;
      const newProgress = Math.min(currentMax, state.realmProgress + amount);
      const ready = newProgress >= currentMax;
      if (ready && !state.isBreakthroughReady) {
        console.log(
          `Zustand: Player ready for breakthrough from ${state.realm}`
        );
      }
      return { realmProgress: newProgress, isBreakthroughReady: ready };
    }),
  // Central function to handle the breakthrough attempt
  attemptBreakthrough: (scene) => {
    const state = get();
    if (!state.isBreakthroughReady) {
      console.warn("Attempted breakthrough when not ready.");
      // TODO: UI Feedback: "Cultivation not sufficient"
      return;
    }

    const currentRealmConfig = getRealmConfig(state.realm);
    const nextRealm = getNextRealm(state.realm);

    if (!nextRealm || !currentRealmConfig) {
      console.error(
        "Cannot attempt breakthrough: Invalid current realm or no next realm."
      );
      return; // Shouldn't happen if isBreakthroughReady is checked properly
    }

    // TODO: Check for required items (read from state.inventory)
    // if (currentRealmConfig.breakthroughItems) { ... check inventory ... }

    console.log(`Attempting breakthrough from ${state.realm} to ${nextRealm}`);

    if (currentRealmConfig.tribulationRequiredForNext) {
      // --- Start Tribulation Scene ---
      console.log("Tribulation required! Starting scene...");
      // Ensure TribulationScene exists and handles success/failure logic,
      // including calling advanceRealm on success.
      scene.scene.start(TRIBULATION_SCENE_KEY, {
        currentRealm: state.realm,
        nextRealm: nextRealm,
        // Pass any other needed data
      });
      // Reset progress/ready state immediately? Or let Tribulation scene handle it?
      // Let's reset here to prevent re-triggering. Tribulation failure needs to handle penalties.
      set({ isBreakthroughReady: false, realmProgress: 0 });
    } else {
      // --- No Tribulation: Direct Success/Failure Roll ---
      // TODO: Add success chance calculation (base + purity aspect + items?)
      const successChance = 0.85; // Example high chance for non-tribulation realms
      const didSucceed = Math.random() < successChance;

      if (didSucceed) {
        console.log("Breakthrough successful!");
        get().advanceRealm(nextRealm); // Call the internal advance function
        // TODO: UI Feedback: Success! Particles, sounds.
      } else {
        console.log("Breakthrough failed!");
        // TODO: Apply penalties (e.g., lose progress, Qi damage, temporary debuff)
        const progressPenalty = state.realmProgressMax * 0.25; // Lose 25% progress
        const qiPenalty = state.coreStats.qi.max * 0.5; // Lose 50% current Qi
        set((prevState) => ({
          isBreakthroughReady: false, // No longer ready
          realmProgress: Math.max(0, prevState.realmProgress - progressPenalty),
          coreStats: {
            ...prevState.coreStats,
            qi: {
              ...prevState.coreStats.qi,
              current: Math.max(0, prevState.coreStats.qi.current - qiPenalty),
            },
          },
          // Add debuff state later if needed
        }));
        // TODO: UI Feedback: Failure! Red flash, sound.
      }
    }
  },

  // Internal action called on successful breakthrough
  advanceRealm: (newRealm) =>
    set((state) => {
      const newRealmConfig = getRealmConfig(newRealm);
      if (!newRealmConfig) return {}; // Should not happen if called correctly

      const { maxHealth, maxQi, maxStamina } = calculateMaxStats(
        newRealm,
        state.soulAspects
      );
      const newCoreStats = {
        health: { current: maxHealth, max: maxHealth }, // Full restore on advance
        qi: { current: maxQi, max: maxQi },
        stamina: { current: maxStamina, max: maxStamina },
      };
      console.log(`Zustand: Advanced to ${newRealm}.`);
      return {
        realm: newRealm,
        realmProgress: 0,
        realmProgressMax: newRealmConfig.progressMax,
        isBreakthroughReady: false, // Reset ready flag
        coreStats: newCoreStats,
      };
    }),
  // Updated enhanceSoulAspect to use config and recalculate stats
  enhanceSoulAspect: (aspectType) => {
    const state = get();
    const currentLevel = state.soulAspects[aspectType];
    const cost = calculateAspectEnhancementCost(currentLevel); // Use config function
    const currentQi = state.coreStats.qi.current;

    if (currentQi >= cost) {
      const newQi = currentQi - cost;
      const newAspects = {
        ...state.soulAspects,
        [aspectType]: currentLevel + 1,
      };

      // Recalculate stats *immediately* after aspect change
      const { maxHealth, maxQi, maxStamina } = calculateMaxStats(
        state.realm,
        newAspects
      );
      const clampedHealth = Math.min(state.coreStats.health.current, maxHealth);
      const clampedStamina = Math.min(
        state.coreStats.stamina.current,
        maxStamina
      );

      set({
        coreStats: {
          health: { current: clampedHealth, max: maxHealth },
          qi: { current: newQi, max: maxQi }, // Use consumed Qi, new Max
          stamina: { current: clampedStamina, max: maxStamina },
        },
        soulAspects: newAspects,
      });
      console.log(
        `Successfully enhanced ${aspectType} to level ${currentLevel + 1}.`
      );
      return true;
    } else {
      console.log(`Failed to enhance ${aspectType}: Not enough Qi.`);
      return false;
    }
  },

  recalculateStats: () =>
    set((state) => {
      const { maxHealth, maxQi, maxStamina } = calculateMaxStats(
        state.realm,
        state.soulAspects
      );
      const clampedHealth = Math.min(state.coreStats.health.current, maxHealth);
      const clampedQi = Math.min(state.coreStats.qi.current, maxQi);
      const clampedStamina = Math.min(
        state.coreStats.stamina.current,
        maxStamina
      );
      return {
        coreStats: {
          health: { current: clampedHealth, max: maxHealth },
          qi: { current: clampedQi, max: maxQi },
          stamina: { current: clampedStamina, max: maxStamina },
        },
      };
    }),
  discoverDao: (daoType) =>
    set((state) => {
      if (state.daoProgress.discovered.has(daoType)) {
        return {}; // Already discovered
      }
      const newDiscovered = new Set(state.daoProgress.discovered).add(daoType);
      const newComprehension = new Map(state.daoProgress.comprehension);
      if (!newComprehension.has(daoType)) {
        newComprehension.set(daoType, 0); // Initialize comprehension at 0
      }
      console.log(`Zustand: Discovered Dao - ${daoType}`);
      return {
        daoProgress: {
          discovered: newDiscovered,
          comprehension: newComprehension,
        },
      };
    }),

  increaseDaoComprehension: (daoType, amount) => {
    const state = get();
    if (!state.daoProgress.discovered.has(daoType)) {
      console.warn(
        `Attempted to increase comprehension for undiscovered Dao: ${daoType}`
      );
      return; // Cannot increase if not discovered
    }

    const currentComprehension =
      state.daoProgress.comprehension.get(daoType) || 0;
    const newComprehensionValue = Math.min(
      MAX_DAO_COMPREHENSION,
      currentComprehension + amount
    );

    // --- Check for Technique Unlocks ---
    let techniquesToAdd: TechniqueID[] = [];
    const unlocksForDao = DaoTechniqueUnlocks[daoType];
    if (unlocksForDao) {
      for (const levelName in DAO_UNLOCK_THRESHOLDS) {
        const threshold =
          DAO_UNLOCK_THRESHOLDS[
            levelName as keyof typeof DAO_UNLOCK_THRESHOLDS
          ];
        // Check if comprehension *crossed* the threshold with this increase
        if (
          currentComprehension < threshold &&
          newComprehensionValue >= threshold
        ) {
          const techniquesAtLevel =
            unlocksForDao[levelName as keyof typeof DAO_UNLOCK_THRESHOLDS];
          if (techniquesAtLevel) {
            techniquesToAdd.push(...techniquesAtLevel);
          }
        }
      }
    }

    // Apply state update
    set((prevState) => {
      const newComprehensionMap = new Map(prevState.daoProgress.comprehension);
      newComprehensionMap.set(daoType, newComprehensionValue);

      // Add newly unlocked techniques to learned set
      let newLearnedTechniques = prevState.learnedTechniques;
      if (techniquesToAdd.length > 0) {
        newLearnedTechniques = new Set(prevState.learnedTechniques);
        techniquesToAdd.forEach((techId) => {
          if (!newLearnedTechniques.has(techId)) {
            newLearnedTechniques.add(techId);
            console.log(
              `Zustand: Unlocked Technique "${techId}" via ${daoType} Dao comprehension!`
            );
            // TODO: Add UI notification?
          }
        });
      }

      return {
        daoProgress: {
          ...prevState.daoProgress,
          comprehension: newComprehensionMap,
        },
        learnedTechniques: newLearnedTechniques,
      };
    });

    console.log(
      `Zustand: Increased ${daoType} Dao comprehension by ${amount} to ${newComprehensionValue}.`
    );
  },

  // Implement other actions...
}));

// Example of an atomic selector (TDD 2.4)
export const selectPlayerHealth = (state: PlayerState) =>
  state.coreStats.health;
