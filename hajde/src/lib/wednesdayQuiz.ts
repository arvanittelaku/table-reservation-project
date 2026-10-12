/** Wednesday Dinner quiz — stable answer codes (not display labels). */
export interface WedQuizQuestion { key: string; type: 'single' | 'langs'; options?: Array<{ v: string }> }
export const WED_QUIZ: WedQuizQuestion[] = [
  {
    key: 'evening',
    type: 'single',
    options: [
      { v: 'deep_talk' },
      { v: 'humor' },
      { v: 'new_ideas' },
      { v: 'mix' },
      { v: 'other' },
    ],
  },
  {
    key: 'role',
    type: 'single',
    options: [
      { v: 'asker' },
      { v: 'storyteller' },
      { v: 'listener' },
      { v: 'joker' },
      { v: 'other' },
    ],
  },
  {
    key: 'topic',
    type: 'single',
    options: [
      { v: 'travel' },
      { v: 'career' },
      { v: 'art_music' },
      { v: 'sport' },
      { v: 'other' },
    ],
  },
  {
    key: 'energy',
    type: 'single',
    options: [
      { v: 'calm' },
      { v: 'medium' },
      { v: 'high' },
      { v: 'other' },
    ],
  },
  { key: 'langs', type: 'langs' },
]

/** Map legacy Albanian answer labels to stable codes (session reload compat). */
const LEGACY_WED_ANSWERS: Record<string, string> = {
  'Biseda të thella': 'deep_talk',
  'Humor e të qeshura': 'humor',
  'Njohje e ide të reja': 'new_ideas',
  'Pak nga të gjitha': 'mix',
  'Diçka tjetër': 'other',
  'Ai që pyet': 'asker',
  'Ai që tregon histori': 'storyteller',
  'Ai që dëgjon': 'listener',
  'Ai që i qesh të gjithë': 'joker',
  Udhëtime: 'travel',
  'Karriera & ide': 'career',
  'Art & muzikë': 'art_music',
  Sport: 'sport',
  'E qetë': 'calm',
  Mesatare: 'medium',
  'E lartë': 'high',
}

export function normalizeWedAnswer<T extends string | string[] | null | undefined>(value: T): T
export function normalizeWedAnswer(value: string | string[] | null | undefined): string | string[] | null | undefined {
  if (value == null) return value
  if (Array.isArray(value)) return value.map((v) => normalizeWedAnswer(v))
  const s = String(value).trim()
  return LEGACY_WED_ANSWERS[s] || s
}
