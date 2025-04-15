// src/data/RealmData.ts
import { RealmDefinition } from '../types';

// Define the sequence and properties of cultivation realms
export const REALM_DEFINITIONS: RealmDefinition[] = [
    {
        id: 'mortal',
        name: 'Mortal',
        expToNextRealm: 100, // Low threshold to start
    },
    {
        id: 'qi_condensation_1',
        name: 'Qi Condensation - Stage 1',
        expToNextRealm: 250,
        baseHpBonus: 10,
        baseQiBonus: 20,
        qiRegenBonus: 0.1,
    },
    {
        id: 'qi_condensation_2',
        name: 'Qi Condensation - Stage 2',
        expToNextRealm: 500,
        baseHpBonus: 15,
        baseQiBonus: 30,
        qiRegenBonus: 0.1,
    },
    {
        id: 'qi_condensation_3',
        name: 'Qi Condensation - Peak',
        expToNextRealm: 1000,
        baseHpBonus: 20,
        baseQiBonus: 50,
        qiRegenBonus: 0.2,
    },
    {
        id: 'foundation_establishment',
        name: 'Foundation Establishment',
        expToNextRealm: 2500,
        baseHpBonus: 100,
        baseQiBonus: 150,
        qiRegenBonus: 0.5,
        unlocksFlight: true, // FLIGHT UNLOCKED HERE!
        requiresTribulation: true, // First major hurdle
        tribulationDifficulty: 1,
    },
    {
        id: 'core_formation_early',
        name: 'Core Formation - Early',
        expToNextRealm: 5000,
        baseHpBonus: 200,
        baseQiBonus: 300,
        qiRegenBonus: 1.0,
        unlocksAlchemy: true, // ALCHEMY UNLOCKED
    },
    {
        id: 'core_formation_mid',
        name: 'Core Formation - Mid',
        expToNextRealm: 10000,
        baseHpBonus: 250,
        baseQiBonus: 400,
        qiRegenBonus: 1.2,
    },
    {
        id: 'core_formation_late',
        name: 'Core Formation - Late',
        expToNextRealm: 20000,
        baseHpBonus: 300,
        baseQiBonus: 500,
        qiRegenBonus: 1.5,
        unlocksAdvancedTechniques: true,
    },
    {
        id: 'nascent_soul',
        name: 'Nascent Soul',
        expToNextRealm: 50000, // Big jump
        baseHpBonus: 500,
        baseQiBonus: 1000,
        qiRegenBonus: 3.0,
        requiresTribulation: true,
        tribulationDifficulty: 5,
    },
    // --- Add more realms: Spirit Severing, Dao Seeking, Immortal Ascension ---
    {
        id: 'immortal_ascension', // Example Max Realm
        name: 'Immortal Ascension',
        expToNextRealm: null, // Max realm
        baseHpBonus: 10000,
        baseQiBonus: 20000,
        qiRegenBonus: 10.0,
        // Special unlocks?
    },
    // ... add intermediate realms as needed
];

// Helper to quickly find a realm definition by ID
export const findRealmById = (id: string): RealmDefinition | undefined =>
    REALM_DEFINITIONS.find(realm => realm.id === id);

// Helper to find the next realm in the sequence
export const findNextRealm = (currentId: string): RealmDefinition | undefined => {
    const currentIndex = REALM_DEFINITIONS.findIndex(realm => realm.id === currentId);
    if (currentIndex !== -1 && currentIndex < REALM_DEFINITIONS.length - 1) {
        return REALM_DEFINITIONS[currentIndex + 1];
    }
    return undefined;
};