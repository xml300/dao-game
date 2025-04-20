// src/config/realms.ts
import { CultivationRealm, ISoulAspects } from '@/types';

// Define an interface for realm configuration
export interface IRealmConfig {
    name: string;
    progressMax: number;
    baseStats: { // Base stats *granted* by this realm
        health: number;
        qi: number;
        stamina: number;
        qiRegen: number; // Base regen per second
        staminaRegen: number; // Base regen per second
    };
    unlocks?: { // Features unlocked upon reaching this realm
        flight?: boolean;
        alchemyTier?: number;
        craftingTier?: number;
        spiritualSense?: boolean; // Example
        // Add other unlocks like new technique types etc.
    };
    // Does reaching the *next* realm require a tribulation AFTER completing this one?
    tribulationRequiredForNext?: boolean;
    // Add breakthrough item requirements later:
    // breakthroughItems?: { itemId: ItemID, quantity: number }[];
}

// Define the configuration map
export const RealmConfig = new Map<CultivationRealm, IRealmConfig>([
    [CultivationRealm.QiCondensation, {
        name: "Qi Condensation",
        progressMax: 100,
        baseStats: { health: 100, qi: 100, stamina: 100, qiRegen: 1.0, staminaRegen: 5.0 },
        unlocks: {},
        tribulationRequiredForNext: false,
    }],
    [CultivationRealm.FoundationEstablishment, {
        name: "Foundation Establishment",
        progressMax: 500,
        baseStats: { health: 250, qi: 200, stamina: 150, qiRegen: 2.0, staminaRegen: 7.0 },
        unlocks: { flight: true, alchemyTier: 1, craftingTier: 1 },
        tribulationRequiredForNext: false, // Set to true if Core Formation needs it
    }],
    [CultivationRealm.CoreFormation, {
        name: "Core Formation",
        progressMax: 2000,
        baseStats: { health: 600, qi: 500, stamina: 300, qiRegen: 5.0, staminaRegen: 10.0 },
        unlocks: { alchemyTier: 2, craftingTier: 2, spiritualSense: true },
        tribulationRequiredForNext: true, // Nascent Soul requires a tribulation
    }],
    [CultivationRealm.NascentSoul, {
        name: "Nascent Soul",
        progressMax: 10000,
        baseStats: { health: 1500, qi: 1200, stamina: 500, qiRegen: 10.0, staminaRegen: 15.0 },
        unlocks: { /* Add Nascent Soul specific unlocks */ },
        tribulationRequiredForNext: false, // Example: Spirit Severing might not
    }],
    // --- Add configurations for SpiritSevering, DaoSeeking, ImmortalAscension ---
    // Ensure the final realm (ImmortalAscension) has tribulationRequiredForNext: false (or handle it gracefully)
    // ...
]);

// Helper function to get config for a realm
export function getRealmConfig(realm: CultivationRealm): IRealmConfig | undefined {
    return RealmConfig.get(realm);
}

// Recalculates max stats based on current realm and aspects
export function calculateMaxStats(realm: CultivationRealm, aspects: ISoulAspects): { maxHealth: number, maxQi: number, maxStamina: number } {
    const realmConf = getRealmConfig(realm);
    if (!realmConf) {
        console.error(`Missing realm config for ${realm}`);
        return { maxHealth: 100, maxQi: 100, maxStamina: 100 }; // Default fallback
    }

    // TDD 5.2.3 Formulas - Adjust factors as needed for balance
    const resilienceFactor = 1.0 + (aspects.resilience * 0.08); // Example: +8% per point
    const affinityFactor = 1.0 + (aspects.affinity * 0.12); // Example: +12% per point

    const maxHealth = realmConf.baseStats.health * resilienceFactor;
    const maxQi = realmConf.baseStats.qi * affinityFactor;
    const maxStamina = realmConf.baseStats.stamina * resilienceFactor; // Linked to resilience

    return {
        maxHealth: Math.round(maxHealth),
        maxQi: Math.round(maxQi),
        maxStamina: Math.round(maxStamina)
    };
}

// Recalculates base regen rates based on current realm and aspects
export function calculateRegenRates(realm: CultivationRealm, aspects: ISoulAspects): { qiRegen: number, staminaRegen: number } {
     const realmConf = getRealmConfig(realm);
     if (!realmConf) {
         return { qiRegen: 0, staminaRegen: 0 };
     }

     // TDD 5.2.3 Formulas - Adjust factors for balance
     const affinityFactor = 1.0 + (aspects.affinity * 0.05); // Example: +5% Qi regen per point
     const resilienceFactor = 1.0 + (aspects.resilience * 0.05); // Example: +5% Stamina regen per point
     // TODO: Add Life Dao bonus here if desired (from daoProgress state)

     const qiRegen = realmConf.baseStats.qiRegen * affinityFactor;
     const staminaRegen = realmConf.baseStats.staminaRegen * resilienceFactor;

     return { qiRegen, staminaRegen };
}

// Helper to get the next realm in the sequence
export function getNextRealm(currentRealm: CultivationRealm): CultivationRealm | null {
    const realms = Object.values(CultivationRealm);
    const currentIndex = realms.indexOf(currentRealm);
    if (currentIndex === -1 || currentIndex >= realms.length - 1) {
        return null; // Already at highest realm or invalid input
    }
    return realms[currentIndex + 1] as CultivationRealm;
}