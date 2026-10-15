// Browser/device-local authoring only. This store never installs or mints a skill.
export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  text: string;
  category: string;
  hashtags: string;
  priceSol: string;
  imageUrl: string;
}
const KEY = 'agentnet:skill-drafts:v1';
const fields = ['id', 'name', 'description', 'text', 'category', 'hashtags', 'priceSol', 'imageUrl'] as const;

export function readSkillDrafts(): SkillDraft[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const drafts: unknown = JSON.parse(raw);
  if (!Array.isArray(drafts) || drafts.some(d => !d || typeof d !== 'object' || fields.some(k => typeof d[k] !== 'string'))) {
    throw new Error('Saved drafts could not be read. Existing data was kept.');
  }
  return drafts as SkillDraft[];
}

export function saveSkillDraft(draft: SkillDraft): void {
  const drafts = readSkillDrafts();
  const previous = drafts.findIndex(d => d.id === draft.id);
  if (previous < 0) drafts.unshift(draft);
  else drafts[previous] = draft;
  localStorage.setItem(KEY, JSON.stringify(drafts));
}
