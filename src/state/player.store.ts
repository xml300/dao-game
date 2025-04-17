import { create } from 'zustand';
import {
    IPlayerCoreStats,
    CultivationRealm,
    ISoulAspects,
    IDaoProgress,
    TechniqueID,
    ItemID,
    FactionID,
    QuestID,
    DaoType
} from '@/types'; // Using alias if configured

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

  // --- Actions ---
  setCoreStats: (stats: Partial<IPlayerCoreStats>) => void;
  takeDamage: (amount: number) => void;
  consumeQi: (amount: number) => boolean; // Returns true if successful
  consumeStamina: (amount: number) => boolean;
  advanceRealm: (newRealm: CultivationRealm, newMaxProgress: number) => void;
  learnTechnique: (id: TechniqueID) => void;
  // ... other actions as needed based on TDD (increaseQi, completeQuest, etc.)
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  // --- Initial State ---
  coreStats: {
    health: { current: 100, max: 100 }, // Initial values
    qi: { current: 50, max: 50 },
    stamina: { current: 100, max: 100 },
  },
  realm: CultivationRealm.QiCondensation, // Starting realm
  realmProgress: 0,
  realmProgressMax: 100, // Example value for Qi Condensation
  soulAspects: {
    resilience: 1, // Starting levels
    perception: 1,
    affinity: 1,
    purity: 1,
  },
  daoProgress: {
    comprehension: new Map(),
    discovered: new Set(),
  },
  learnedTechniques: new Set(),
  activeTechniques: [null, null, null, null], // Example: 4 active slots
  inventory: new Map(),
  equipment: { weapon: null, armor: null, accessory: null }, // Example slots
  factionReputation: new Map(),
  activeQuests: new Map(),
  completedQuests: new Set(),

  // --- Actions Implementation ---
  setCoreStats: (statsUpdate) => set((state) => ({
      coreStats: { ...state.coreStats, ...statsUpdate }
  })),

  takeDamage: (amount) => set((state) => {
      const newHealth = Math.max(0, state.coreStats.health.current - amount);
      // Potentially clamp to max health if healing involved later
      return {
          coreStats: {
              ...state.coreStats,
              health: { ...state.coreStats.health, current: newHealth }
          }
      };
  }),

  consumeQi: (amount) => {
      const currentQi = get().coreStats.qi.current;
      if (currentQi >= amount) {
          set((state) => ({
              coreStats: {
                  ...state.coreStats,
                  qi: { ...state.coreStats.qi, current: currentQi - amount }
              }
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
                   stamina: { ...state.coreStats.stamina, current: currentStamina - amount }
               }
           }));
           return true;
       }
       return false;
   },

  advanceRealm: (newRealm, newMaxProgress) => set({
      realm: newRealm,
      realmProgress: 0,
      realmProgressMax: newMaxProgress
      // Add logic here or in a separate system to update base stats based on new realm (TDD 5.1.3)
  }),

  learnTechnique: (id) => set((state) => ({
      learnedTechniques: new Set(state.learnedTechniques).add(id)
  })),

  // Implement other actions...
}));

// Example of an atomic selector (TDD 2.4)
export const selectPlayerHealth = (state: PlayerState) => state.coreStats.health;