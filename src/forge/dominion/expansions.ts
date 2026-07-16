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

export const EXPANSIONS: ExpansionModule[] = [
  base2e, intrigue2eA, intrigue2eB, intrigue2eC,
  seaside2eA, seaside2eB, seaside2eC,
];
