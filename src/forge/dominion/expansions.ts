/**
 * The expansion registry: every module listed here is merged into the
 * built-in Dominion def by buildDominionDef (piles, ids, cards, type-line
 * tags, variables, zones, triggers, actions, VP terms, cleanup resets).
 */
import type { ExpansionModule } from './kit';
import { base2e } from './base2e';
import { intrigue2eA } from './intrigue2eA';
import { intrigue2eB } from './intrigue2eB';
import { intrigue2eC } from './intrigue2eC';
import { seaside2eA } from './seaside2eA';
import { seaside2eB } from './seaside2eB';
import { seaside2eC } from './seaside2eC';
import { prosperity2eA } from './prosperity2eA';
import { prosperity2eB } from './prosperity2eB';
import { cornucopia1e } from './cornucopia1e';
import { guilds1e } from './guilds1e';
import { hinterlands2eA } from './hinterlands2eA';
import { hinterlands2eB } from './hinterlands2eB';
import { promos1 } from './promos1';
import { alchemy1e } from './alchemy1e';
import { menagerieA } from './menagerieA';
import { menagerieB } from './menagerieB';
import { empiresLandmarks } from './empiresLandmarks';
import { empiresEvents } from './empiresEvents';
import { renaissanceProjects } from './renaissanceProjects';
import { renaissanceA } from './renaissanceA';
import { renaissanceB } from './renaissanceB';
import { menagerieWays } from './menagerieWays';
import { adventuresEvents } from './adventuresEvents';
import { adventuresA } from './adventuresA';
import { adventuresB } from './adventuresB';
import { adventuresTokens } from './adventuresTokens';

export const EXPANSIONS: ExpansionModule[] = [
  base2e, intrigue2eA, intrigue2eB, intrigue2eC,
  seaside2eA, seaside2eB, seaside2eC,
  prosperity2eA, prosperity2eB, cornucopia1e, guilds1e,
  hinterlands2eA, hinterlands2eB, promos1,
  alchemy1e,
  // menagerieA declares the shared Exile mat / Horse stock and the shared
  // exile-discharge trigger — it must precede menagerieB, whose cards
  // reference those zones and assume that trigger fires first on a gain.
  menagerieA, menagerieB,
  // Empires' landscape side (the kingdom waits on split piles).
  empiresLandmarks, empiresEvents,
  // Renaissance: renaissanceA declares the five artifact vars (and leans on
  // seaside2eA's Haven mark, registered far above); B reads A's artifacts.
  renaissanceProjects, renaissanceA, renaissanceB,
  // Ways reference menagerieA's mats + seaside2eA's Haven mark by id.
  menagerieWays, adventuresEvents,
  // Adventures: A declares the Tavern mat + Traveller stock and Teacher
  // writes the token vars that adventuresTokens declares — register all
  // three together (order among them is free; the merged def needs all).
  adventuresA, adventuresB, adventuresTokens,
];
