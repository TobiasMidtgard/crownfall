/**
 * Pure helpers for the card designer: sample preview data, element factories,
 * and immutable GameDef update functions (templates, fields, cards).
 */
import type {
  AbilityDef, CardDef, CardFieldDef, CardTemplate, GameDef, TemplateElement,
} from '../shared/types';
import type { CardLike } from '../components/CardView';
import { deepClone, uid } from '../shared/defaults';

export interface Rect { x: number; y: number; w: number; h: number }

/** Clamp to [min,max] and snap to 0.5% steps (template coordinate grid). */
export function clampPct(v: number, min = 0, max = 100): number {
  const snapped = Math.round(v * 2) / 2;
  return Math.min(max, Math.max(min, snapped));
}

// ---------------------------------------------------------------------------
// Sample/preview data
// ---------------------------------------------------------------------------

/** Sample field values for template previews: text=field name, number=3, image=empty. */
export function sampleFields(template: CardTemplate): Record<string, string | number> {
  const fields: Record<string, string | number> = { name: 'Card Name' };
  for (const f of template.fields) {
    fields[f.id] = f.type === 'number' ? 3 : f.type === 'image' ? '' : f.name;
  }
  return fields;
}

export function sampleCard(template: CardTemplate): CardLike {
  return { name: 'Card Name', templateId: template.id, fields: sampleFields(template), faceUp: true };
}

/** CardLike for a real card def (exposes the built-in 'name' field). */
export function cardPreview(card: CardDef): CardLike {
  return {
    name: card.name,
    templateId: card.templateId,
    fields: { ...card.fields, name: card.name },
    faceUp: true,
  };
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

export const ELEMENT_KINDS = ['text', 'stat', 'image', 'box'] as const;
export type ElementKind = TemplateElement['kind'];

export const ELEMENT_ICON: Record<ElementKind, string> = {
  text: 'T', stat: '◉', image: '▣', box: '■',
};

export const ELEMENT_KIND_LABEL: Record<ElementKind, string> = {
  text: 'Text', stat: 'Stat chip', image: 'Image', box: 'Box',
};

/** Display name of a field id within a template ('name' is built in). */
export function fieldName(template: CardTemplate, fieldId: string): string {
  if (fieldId === 'name') return 'Name (built-in)';
  return template.fields.find((f) => f.id === fieldId)?.name ?? '(missing field)';
}

export function elementLabel(el: TemplateElement, template: CardTemplate): string {
  switch (el.kind) {
    case 'text':
      return el.bind !== null ? `Text · ${fieldName(template, el.bind)}` : `Text · “${el.text || 'empty'}”`;
    case 'stat':
      return el.bind !== null ? `Stat · ${fieldName(template, el.bind)}` : 'Stat chip';
    case 'image':
      return el.bind !== null ? `Image · ${fieldName(template, el.bind)}` : 'Image';
    case 'box':
      return 'Box';
  }
}

/** New element with sensible defaults, centered on the card. */
export function newElement(kind: ElementKind, aspect: number): TemplateElement {
  const id = uid('el');
  switch (kind) {
    case 'text':
      return {
        kind: 'text', id, bind: null, text: 'Text',
        x: 10, y: 44, w: 80, h: 12,
        fontSize: 8, bold: false, italic: false, align: 'center', color: '#f2f3f8',
      };
    case 'stat': {
      // Make the chip square in *pixels*: h% = w% * aspect.
      const w = 18;
      const h = clampPct(w * aspect, 2, 100);
      return {
        kind: 'stat', id, bind: null,
        x: clampPct(50 - w / 2), y: clampPct(50 - h / 2), w, h,
        shape: 'circle', bg: '#7c5cff', color: '#ffffff', fontSize: 9,
      };
    }
    case 'image':
      return { kind: 'image', id, bind: null, src: '', x: 15, y: 28, w: 70, h: 40, fit: 'cover', radius: 2 };
    case 'box':
      return { kind: 'box', id, x: 10, y: 35, w: 80, h: 30, fill: '#232743', radius: 2 };
  }
}

// ---------------------------------------------------------------------------
// Immutable GameDef updates — templates
// ---------------------------------------------------------------------------

export function patchTemplate(def: GameDef, tplId: string, patch: Partial<CardTemplate>): GameDef {
  return { ...def, templates: def.templates.map((t) => (t.id === tplId ? { ...t, ...patch } : t)) };
}

export function updateElement(
  def: GameDef, tplId: string, elId: string, up: (el: TemplateElement) => TemplateElement,
): GameDef {
  return patchTemplate(def, tplId, {
    elements: def.templates.find((t) => t.id === tplId)?.elements.map((el) => (el.id === elId ? up(el) : el)) ?? [],
  });
}

export function setElementRect(def: GameDef, tplId: string, elId: string, rect: Rect): GameDef {
  return updateElement(def, tplId, elId, (el) => ({ ...el, ...rect }));
}

/** Move an element within the z-order (array order = bottom→top). */
export function moveElement(def: GameDef, tplId: string, elId: string, dir: 1 | -1): GameDef {
  const tpl = def.templates.find((t) => t.id === tplId);
  if (!tpl) return def;
  const i = tpl.elements.findIndex((el) => el.id === elId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tpl.elements.length) return def;
  const elements = [...tpl.elements];
  [elements[i], elements[j]] = [elements[j], elements[i]];
  return patchTemplate(def, tplId, { elements });
}

export function deleteElement(def: GameDef, tplId: string, elId: string): GameDef {
  const tpl = def.templates.find((t) => t.id === tplId);
  if (!tpl) return def;
  return patchTemplate(def, tplId, { elements: tpl.elements.filter((el) => el.id !== elId) });
}

/** Deep-copy a template with fresh ids; element binds are remapped to the new field ids. */
export function duplicateTemplate(def: GameDef, tplId: string): { def: GameDef; newId: string | null } {
  const src = def.templates.find((t) => t.id === tplId);
  if (!src) return { def, newId: null };
  const copy = deepClone(src);
  copy.id = uid('tpl');
  copy.name = `${src.name} copy`;
  const fieldMap = new Map<string, string>();
  copy.fields = copy.fields.map((f) => {
    const nid = uid('field');
    fieldMap.set(f.id, nid);
    return { ...f, id: nid };
  });
  copy.elements = copy.elements.map((el) => {
    const nid = uid('el');
    if (el.kind !== 'box' && el.bind !== null) {
      return { ...el, id: nid, bind: fieldMap.get(el.bind) ?? el.bind };
    }
    return { ...el, id: nid };
  });
  return { def: { ...def, templates: [...def.templates, copy] }, newId: copy.id };
}

/** Cards using a template (would be orphaned by deleting it). */
export function cardsUsingTemplate(def: GameDef, tplId: string): CardDef[] {
  return def.cards.filter((c) => c.templateId === tplId);
}

/** Delete a template plus its cards, and drop those cards from custom decks. */
export function deleteTemplate(def: GameDef, tplId: string): GameDef {
  const dead = new Set(cardsUsingTemplate(def, tplId).map((c) => c.id));
  return {
    ...def,
    templates: def.templates.filter((t) => t.id !== tplId),
    cards: def.cards.filter((c) => !dead.has(c.id)),
    decks: def.decks.map((d) => (d.source.kind === 'custom'
      ? { ...d, source: { ...d.source, entries: d.source.entries.filter((e) => !dead.has(e.cardId)) } }
      : d)),
  };
}

// ---------------------------------------------------------------------------
// Immutable GameDef updates — field schema
// ---------------------------------------------------------------------------

export function newField(): CardFieldDef {
  return { id: uid('field'), name: 'New field', type: 'text' };
}

export function patchField(def: GameDef, tplId: string, fieldId: string, patch: Partial<CardFieldDef>): GameDef {
  const tpl = def.templates.find((t) => t.id === tplId);
  if (!tpl) return def;
  return patchTemplate(def, tplId, {
    fields: tpl.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
  });
}

/** Number of cards that store a value for this field (for the removal warning). */
export function cardsWithFieldValue(def: GameDef, fieldId: string): number {
  return def.cards.filter((c) => fieldId in c.fields).length;
}

/** Remove a field: unbind elements pointing at it and delete the key from every card. */
export function removeField(def: GameDef, tplId: string, fieldId: string): GameDef {
  return {
    ...def,
    templates: def.templates.map((t) => (t.id !== tplId ? t : {
      ...t,
      fields: t.fields.filter((f) => f.id !== fieldId),
      elements: t.elements.map((el) => (el.kind !== 'box' && el.bind === fieldId ? { ...el, bind: null } : el)),
    })),
    cards: def.cards.map((c) => {
      if (!(fieldId in c.fields)) return c;
      const fields = { ...c.fields };
      delete fields[fieldId];
      return { ...c, fields };
    }),
  };
}

// ---------------------------------------------------------------------------
// Immutable GameDef updates — cards
// ---------------------------------------------------------------------------

export function patchCard(def: GameDef, cardId: string, patch: Partial<CardDef>): GameDef {
  return { ...def, cards: def.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) };
}

export function setCardField(def: GameDef, cardId: string, fieldId: string, value: string | number): GameDef {
  const card = def.cards.find((c) => c.id === cardId);
  if (!card) return def;
  return patchCard(def, cardId, { fields: { ...card.fields, [fieldId]: value } });
}

export function duplicateCard(def: GameDef, cardId: string): { def: GameDef; newId: string | null } {
  const src = def.cards.find((c) => c.id === cardId);
  if (!src) return { def, newId: null };
  const copy = deepClone(src);
  copy.id = uid('card');
  copy.name = `${src.name} copy`;
  copy.abilities = copy.abilities.map((a) => ({ ...a, id: uid('ability') }));
  const i = def.cards.findIndex((c) => c.id === cardId);
  const cards = [...def.cards];
  cards.splice(i + 1, 0, copy);
  return { def: { ...def, cards }, newId: copy.id };
}

/** Delete a card and drop it from any custom deck entries. */
export function deleteCard(def: GameDef, cardId: string): GameDef {
  return {
    ...def,
    cards: def.cards.filter((c) => c.id !== cardId),
    decks: def.decks.map((d) => (d.source.kind === 'custom'
      ? { ...d, source: { ...d.source, entries: d.source.entries.filter((e) => e.cardId !== cardId) } }
      : d)),
  };
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export function newAbility(def: GameDef): AbilityDef {
  return {
    id: uid('ability'),
    name: 'New ability',
    on: 'enterZone',
    zoneId: def.zones[0]?.id ?? null,
    phaseId: null,
    condition: null,
    script: [],
  };
}
