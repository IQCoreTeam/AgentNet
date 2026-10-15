import { beforeEach, expect, it } from 'vitest';
import { readSkillDrafts, saveSkillDraft, type SkillDraft } from './skillDrafts';
const draft: SkillDraft = { id: 'local-1', name: 'qa-skill', description: 'Local test skill', text: 'Inspect the fixture only.', category: 'development', hashtags: 'qa', priceSol: '0', imageUrl: '' };
beforeEach(() => localStorage.clear());
it('keeps multiple drafts and updates the same draft without duplicating it', () => {
  saveSkillDraft(draft);
  saveSkillDraft({ ...draft, id: 'local-2', name: 'second' });
  saveSkillDraft({ ...draft, text: 'Revised draft' });
  expect(readSkillDrafts()).toEqual([{ ...draft, id: 'local-2', name: 'second' }, { ...draft, text: 'Revised draft' }]);
});
it('preserves malformed stored data instead of replacing it during save', () => {
  localStorage.setItem('agentnet:skill-drafts:v1', '{broken');
  expect(() => saveSkillDraft(draft)).toThrow();
  expect(localStorage.getItem('agentnet:skill-drafts:v1')).toBe('{broken');
});
it('rejects malformed entries without rendering or treating them as skills', () => {
  localStorage.setItem('agentnet:skill-drafts:v1', JSON.stringify([{ name: 'incomplete' }]));
  expect(() => readSkillDrafts()).toThrow('Existing data was kept');
});
