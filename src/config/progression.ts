// src/config/progression.ts
import { DaoType, TechniqueID, CultivationRealm } from '@/types';

// --- Soul Aspect Costs ---
export const SOUL_ASPECT_BASE_QI_COST = 50;
export const SOUL_ASPECT_LEVEL_MULTIPLIER = 1.3; // Exponential scaling

export function calculateAspectEnhancementCost(currentLevel: number): number {
    // Level 0 cost (to reach level 1): 50 * (1.3^0) = 50
    // Level 1 cost (to reach level 2): 50 * (1.3^1) = 65
    // Level 2 cost (to reach level 3): 50 * (1.3^2) = 84.5 -> 85
    return Math.ceil(SOUL_ASPECT_BASE_QI_COST * Math.pow(SOUL_ASPECT_LEVEL_MULTIPLIER, currentLevel));
}

// --- Dao Comprehension & Unlocks ---
export const MAX_DAO_COMPREHENSION = 100; // Using 0-100 scale

// Define comprehension thresholds for technique unlocks
export const DAO_UNLOCK_THRESHOLDS = {
    Initial: 10,
    Minor: 30,
    Major: 60,
    Mastery: 90,
} as const; // Use 'as const' for stricter typing of keys

export type DaoComprehensionLevelName = keyof typeof DAO_UNLOCK_THRESHOLDS;

// Define techniques unlocked by Daos
// Use Partial<...> because not all levels might unlock techniques for every Dao
export const DaoTechniqueUnlocks: Partial<Record<DaoType, Partial<Record<DaoComprehensionLevelName, TechniqueID[]>>>> = {
    [DaoType.Fire]: {
        Minor: ['tech_fireball_upgrade1'], // Example ID - needs definition in technique.ts
        Major: ['tech_flame_aoe'],
        Mastery: ['tech_meteor_shower']
    },
    [DaoType.Sword]: {
        Minor: ['tech_sword_passive_boost'],
        Major: ['tech_sword_dash_attack'],
        Mastery: ['tech_infinite_sword_works'] // Ambitious!
    },
    [DaoType.Time]: {
        // Note: Time Stop requires Mastery according to TDD 6.4.1
        Mastery: ['tech_time_stop'] // Needs definition!
    },
    [DaoType.Space]: {
        Minor: ['tech_blink_range_increase'], // Passive effect handled elsewhere, but maybe unlock indicator?
        Major: ['tech_spatial_rift_teleport'], // Long range teleport technique?
        Mastery: ['tech_pocket_dimension'] // Utility technique?
    },
    // ... add unlocks for other Dao types ...
};

// --- Tribulation Config (Placeholder) ---
export const TRIBULATION_SCENE_KEY = 'TribulationScene'; // Define this scene later

// --- Passive Bonus Factors (Example - used by systems) ---
export const DAO_PASSIVE_FACTORS = {
    SWORD_DAMAGE_PER_LEVEL: 0.01, // +1% damage per comprehension point
    FIRE_BURN_CHANCE_PER_LEVEL: 0.005, // +0.5% burn chance per point
    SPACE_BLINK_COST_REDUCTION_PER_LEVEL: 0.008, // 0.8% cost reduction per point
    LIFE_REGEN_BONUS_PER_LEVEL: 0.01, // +1% to calculated regen per point
    // Add factors for other Daos (Time cooldown reduction, Water slow effect, etc.)
};