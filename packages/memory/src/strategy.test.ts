import { describe, expect, it } from 'vitest';

import { classifyQueryStrategy, getStrategyWeights } from './strategy.js';

describe('classifyQueryStrategy', () => {
  it('classifies factual queries', () => {
    expect(classifyQueryStrategy('what is the database schema')).toBe('factual');
    expect(classifyQueryStrategy("who is the project lead")).toBe('factual');
    expect(classifyQueryStrategy('tell me about the auth system')).toBe('factual');
  });

  it('classifies temporal queries', () => {
    expect(classifyQueryStrategy('what happened yesterday')).toBe('temporal');
    expect(classifyQueryStrategy('what changed recently')).toBe('temporal');
    expect(classifyQueryStrategy('latest updates this week')).toBe('temporal');
  });

  it('classifies procedural queries', () => {
    expect(classifyQueryStrategy('how to deploy the application')).toBe('procedural');
    expect(classifyQueryStrategy('steps to set up the database')).toBe('procedural');
    expect(classifyQueryStrategy('workflow for releasing')).toBe('procedural');
  });

  it('defaults to exploratory for ambiguous queries', () => {
    expect(classifyQueryStrategy('database migration')).toBe('exploratory');
    expect(classifyQueryStrategy('auth configuration')).toBe('exploratory');
    expect(classifyQueryStrategy('typescript strict mode')).toBe('exploratory');
  });

  it('temporal takes priority over factual', () => {
    // "what is" is factual, "recently" is temporal — temporal wins
    expect(classifyQueryStrategy('what is the most recently added feature')).toBe('temporal');
  });
});

describe('getStrategyWeights', () => {
  it('returns weights that sum to 1.0 for each strategy', () => {
    for (const strategy of ['factual', 'temporal', 'procedural', 'exploratory'] as const) {
      const w = getStrategyWeights(strategy);
      const sum = w.relevance + w.recency + w.confidence + w.scopeMatch + w.entityBoost;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it('exploratory matches original hardcoded weights', () => {
    const w = getStrategyWeights('exploratory');
    expect(w.relevance).toBe(0.40);
    expect(w.recency).toBe(0.25);
    expect(w.confidence).toBe(0.20);
    expect(w.scopeMatch).toBe(0.15);
    expect(w.entityBoost).toBe(0.00);
  });

  it('temporal weights recency highest', () => {
    const w = getStrategyWeights('temporal');
    expect(w.recency).toBeGreaterThan(w.relevance);
    expect(w.recency).toBeGreaterThan(w.confidence);
  });

  it('factual weights confidence highest', () => {
    const w = getStrategyWeights('factual');
    expect(w.confidence).toBeGreaterThan(w.relevance);
    expect(w.confidence).toBeGreaterThan(w.recency);
  });

  it('procedural weights relevance highest', () => {
    const w = getStrategyWeights('procedural');
    expect(w.relevance).toBeGreaterThan(w.recency);
    expect(w.relevance).toBeGreaterThan(w.confidence);
  });
});
