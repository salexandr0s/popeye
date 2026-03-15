import { describe, expect, it } from 'vitest';

import { extractEntities, canonicalizeEntityName } from './entity-extraction.js';

describe('canonicalizeEntityName', () => {
  it('lowercases and trims', () => {
    expect(canonicalizeEntityName('  Alex Smith  ')).toBe('alex smith');
  });

  it('collapses whitespace', () => {
    expect(canonicalizeEntityName('Foo   Bar')).toBe('foo bar');
  });
});

describe('extractEntities', () => {
  it('extracts person names after "name is"', () => {
    const entities = extractEntities('My name is Alex Smith and I work on Popeye');
    const people = entities.filter((e) => e.type === 'person');
    expect(people.length).toBeGreaterThanOrEqual(1);
    expect(people.some((p) => p.canonicalName.includes('alex'))).toBe(true);
  });

  it('extracts @scope/package projects', () => {
    const entities = extractEntities('We use @popeye/memory for the memory system');
    const projects = entities.filter((e) => e.type === 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0]!.canonicalName).toBe('@popeye/memory');
  });

  it('extracts tool names', () => {
    const entities = extractEntities('The project uses TypeScript and Vitest for testing with Fastify');
    const tools = entities.filter((e) => e.type === 'tool');
    expect(tools.length).toBe(3);
    const names = tools.map((t) => t.canonicalName);
    expect(names).toContain('typescript');
    expect(names).toContain('vitest');
    expect(names).toContain('fastify');
  });

  it('extracts organizations', () => {
    const entities = extractEntities('The company Acme Corp builds software');
    const orgs = entities.filter((e) => e.type === 'org');
    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(orgs.some((o) => o.canonicalName.includes('acme'))).toBe(true);
  });

  it('deduplicates by canonical name and type', () => {
    const entities = extractEntities('TypeScript is great. We love TypeScript. TypeScript everywhere.');
    const tools = entities.filter((e) => e.type === 'tool' && e.canonicalName === 'typescript');
    expect(tools).toHaveLength(1);
  });

  it('returns empty for generic text without entities', () => {
    const entities = extractEntities('this is a generic sentence without any notable entities');
    // May have zero or very few (no tools, no proper names)
    const people = entities.filter((e) => e.type === 'person');
    expect(people).toHaveLength(0);
  });

  it('does not extract common words as person names', () => {
    const entities = extractEntities('The data is stored in memory and the test passes');
    const people = entities.filter((e) => e.type === 'person');
    expect(people).toHaveLength(0);
  });
});
