import { knownTrades, queriesFor, scopeOf } from './trends/trend-feed';
import { tradeKeywordsFor } from './trends/trade-keywords';
import { playbookFor, videoFeeds } from './industry-playbook';
import { personaFor } from '../common/business-persona';

/**
 * EVERY CLIENT'S SCREEN LOOKED LIKE A NAIL SALON'S.
 *
 * Not because the per-trade engine was missing — it was written and tested —
 * but because everything a food business touched fell through to SALON: the
 * keyword table had no RESTAURANT row, the playbook had no café, and the
 * persona had four values where the product has a dozen trades. A bubble tea
 * shop asked what to post and was told to film a gel set.
 *
 * These run over the trades by NAME, from the engine's own registry, so a
 * trade added later without its material is caught here rather than by a
 * customer reading nail advice on their own dashboard.
 */
const FOOD = ['RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD'] as const;
// Word boundaries matter here: "brown sugar boba" is correct bubble-tea
// vocabulary and an unanchored /brow/ flagged it. A guard that cries wolf on
// real copy gets deleted by the next person, which costs more than it saves.
const NAIL = /\bnails?\b|\bmóng\b|\bmanicure\b|\bpedicure\b|\bgel ?x\b|\bacrylic\b|\blash(es|est)?\b|\bbrows?\b|salon tóc/i;

describe('the food trades exist as first-class trades', () => {
  it.each(FOOD)('%s is in the engine registry', (t) => {
    expect(knownTrades()).toContain(t);
  });

  it.each(FOOD)('%s gets its own trend queries, not the salon ones', (t) => {
    const q = queriesFor(t);
    expect(JSON.stringify(q)).not.toMatch(NAIL);
    expect(q).not.toEqual(queriesFor('SALON'));
  });

  it.each(FOOD)('%s buckets its shared snapshot under itself', (t) => {
    expect(scopeOf(t, 'US')).toContain(t);
  });
});

describe('no food trade is handed nail material', () => {
  it.each(FOOD)('%s ad groups and SEO topics are free of it (US)', (t) => {
    expect(JSON.stringify(tradeKeywordsFor(t, 'US'))).not.toMatch(NAIL);
  });

  it.each(FOOD)('%s ad groups and SEO topics are free of it (VN)', (t) => {
    expect(JSON.stringify(tradeKeywordsFor(t, 'VN'))).not.toMatch(NAIL);
  });

  it.each(FOOD)('%s video feeds are free of it', (t) => {
    expect(JSON.stringify(videoFeeds(t))).not.toMatch(NAIL);
  });

  it.each(FOOD)('%s falls back to the restaurant playbook, never the nail one', (t) => {
    expect(JSON.stringify(playbookFor(t))).not.toMatch(NAIL);
  });

  it.each(FOOD)('%s never introduces itself as a nail salon', (t) => {
    expect(personaFor('RESTAURANT', t).identity).not.toMatch(NAIL);
  });
});

describe('each food trade is actually distinct', () => {
  it('no two of them share a keyword map — otherwise the split bought nothing', () => {
    const seen = new Set(FOOD.map((t) => JSON.stringify(tradeKeywordsFor(t, 'US'))));
    expect(seen.size).toBe(FOOD.length);
  });

  it('a café is not told to take a table reservation', () => {
    // The restaurant goal opens with exactly that line; a café must not inherit it.
    expect(personaFor('RESTAURANT').voiceGoal).toMatch(/table reservation/i);
    expect(personaFor('RESTAURANT', 'CAFE').voiceGoal).not.toMatch(/Goal: take a table reservation/i);
  });

  it('every food trade answers questions before it tries to book anything', () => {
    for (const t of ['CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD']) {
      expect(personaFor('RESTAURANT', t).voiceGoal).toMatch(/ANSWER/);
    }
  });
});

describe('the beauty trades are untouched', () => {
  it.each(['SALON', 'NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU'])('%s still has its own material', (t) => {
    expect(knownTrades()).toContain(t);
    expect(tradeKeywordsFor(t, 'US').adGroups.length).toBeGreaterThan(0);
  });

  it('a salon tenant that declared nothing is byte-identical to before', () => {
    expect(personaFor('SALON')).toEqual(personaFor('SALON', null));
    expect(personaFor(null).identity).toBe('a nail salon');
  });
});
