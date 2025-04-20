import { SystemResources } from "@/features/common/systems";
import { IWorld } from "bitecs";

// TDD Appendix 13.1 - Player State Slice (Example Subset)
export interface IPlayerCoreStats {
  health: { current: number; max: number };
  qi: { current: number; max: number };
  stamina: { current: number; max: number };
}

// TDD Appendix 13.1 - Enums (Examples)
export enum CultivationRealm {
  QiCondensation = "QiCondensation",
  FoundationEstablishment = "FoundationEstablishment",
  CoreFormation = "CoreFormation",
  NascentSoul = "NascentSoul",
  SpiritSevering = "SpiritSevering",
  DaoSeeking = "DaoSeeking",
  ImmortalAscension = "ImmortalAscension",
}

export enum DaoType {
  Sword = "Sword",
  Fire = "Fire",
  Water = "Water",
  Wind = "Wind",
  Earth = "Earth",
  Lightning = "Lightning",
  Space = "Space",
  Time = "Time",
  Life = "Life",
  Death = "Death",
  Illusion = "Illusion",
  Formation = "Formation",
}

// TDD Appendix 13.1 - Soul Aspects
export interface ISoulAspects {
  resilience: number;
  perception: number;
  affinity: number;
  purity: number;
}

// TDD Appendix 13.1 - Dao Progress
export interface IDaoProgress {
  comprehension: Map<DaoType, number>; // Level or percentage (0-100?)
  discovered: Set<DaoType>;
}

// TDD 3.1 (Hybrid ECS Components) & 3.2
export interface InputState {
  // Movement axes (-1 to 1)
  moveX: number;
  moveY: number;
  // Action flags (0 or 1, or timestamp of press?)
  attackLight: number;
  attackHeavy: number;
  dodge: number;
  interact: number;
  openMenu: number;
  technique1: number; // etc. for other technique slots
  sprint: number; // 0 or 1 (held)
}

export interface MovementState {
  // TDD 4.6 (Used for animation control)
  isIdle: boolean;
  isRunning: boolean;
  isJumping: boolean; // Add later if platforming
  isFalling: boolean; // Add later if platforming
  isFlying: boolean; // TDD 6.2
  isDodging: boolean; // TDD 4.2.1
  isAttacking: boolean; // Add later
  isCasting: boolean; // TDD 4.2.2
  isParrying: boolean; // TDD 4.2.1
  isHurt: boolean; // TDD 4.5
  isDead: boolean; // TDD 4.3.1
}

// Simple Health component for ECS sync (TDD 3.3)
export interface Health {
  current: number;
  max: number;
}
export interface QiPool {
  // TDD 3.3
  current: number;
  max: number;
}
export interface StaminaPool {
  // TDD 3.3
  current: number;
  max: number;
}

// Add other core types referenced in Appendix or TDD here...
export type TechniqueID = string;
export type ItemID = string;
export type FactionID = string;
export type QuestID = string;

export type TechniqueEffectType =
  | "Projectile"
  | "AoE"
  | "Buff"
  | "Debuff"
  | "Barrier"
  | "Movement";

// Placeholder for Combat Component Types (TDD 2.5, Appendix 13.1)
// Will be defined properly when implementing combat features
export interface Position {
  x: number;
  y: number;
}
export interface Velocity {
  vx: number;
  vy: number;
}
export interface Health {
  current: number;
  max: number;
}
export interface Renderable {
  spriteKey: string;
  animation: string;
  tint?: number;
}
export interface PlayerControlled {} // Tag component
export interface InputState {
  /* ... processed input data ... */
}
export interface PhysicsBody {
  bodyRef: any /* Phaser Body or ID */;
}

// Basic structure for defining techniques (load from JSON/config later)
export interface ITechniqueData {
  id: TechniqueID;
  name: string;
  description: string;
  qiCost: number;
  cooldown: number; // In seconds
  animationKey?: string; // Animation to play on cast
  effectType: TechniqueEffectType;
  effectData: any; // Specific data based on effectType
  // Example effectData structures:
  // Projectile: { key: string, speed: number, damage: number, hitboxW: number, hitboxH: number, lifespanMs: number, statusEffect?: StatusEffectData }
  // AoE: { radius: number, damage: number, durationMs: number, visualEffectKey?: string, statusEffect?: StatusEffectData }
  // Buff: { stat: string, amount: number, durationMs: number, visualEffectKey?: string }
  // Movement: { type: 'Blink' | 'Dash', distance?: number, speed?: number }
  requiredDao?: { type: DaoType; level: number }; // TDD 5.3.3
  requiredRealm?: CultivationRealm; // TDD 5.1.3
}

export interface ISoulAspects {
  resilience: number;
  perception: number;
  affinity: number;
  purity: number;
}

export type SoulAspectType = keyof ISoulAspects; // 'resilience' | 'perception' | 'affinity' | 'purity'


export interface IDaoProgress {
  comprehension: Map<DaoType, number>; // Level or percentage
  discovered: Set<DaoType>;
}

export interface InWorld extends IWorld {
  resources: SystemResources;
}
