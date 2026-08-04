import { describe, expect, it } from 'vitest';
import { esc, jsonLd, llmsTxt } from './prerender.js';
import type { Manifest } from '../web/src/schema.js';

const manifest: Manifest = {
  generatedAt: '2026-08-03T00:00:00.000Z',
  sourceVersion: '1',
  seasons: { from: 1987, to: 2026 },
  totals: { tournaments: 2163, players: 15628, partnerships: 18900 },
  tiers: { 'FIVB World Tour': 1517, 'Olympic Games': 22 },
  countries: [],
};

describe('esc', () => {
  it('escapes the characters that break out of element content', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes, since names are also written into attributes', () => {
    // Real FIVB data: José Marco "Zé Marco" Nóbrega Ferreira da Silva.
    expect(esc('José Marco "Zé Marco"')).toBe('José Marco &quot;Zé Marco&quot;');
    expect(esc("O'Brien")).toBe('O&#39;Brien');
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(esc('A & <B>')).toBe('A &amp; &lt;B&gt;');
    expect(esc('&amp;')).toBe('&amp;amp;');
  });

  it('leaves ordinary text and accents untouched', () => {
    expect(esc('Anders Berntsen Mol')).toBe('Anders Berntsen Mol');
    expect(esc('Ágatha Bednarczuk')).toBe('Ágatha Bednarczuk');
  });
});

describe('llmsTxt', () => {
  const slices = [
    { name: 'Brazil', gender: 'M' as const, href: '/brazil-men/' },
    { name: 'Norway', gender: 'W' as const, href: '/norway-women/' },
  ];

  it('opens with the llmstxt.org shape: an H1 then a blockquote summary', () => {
    const lines = llmsTxt(manifest, slices).split('\n');
    expect(lines[0]).toBe('# Beach Volleyball Partnership Graph');
    expect(lines.find((l) => l.startsWith('>'))).toBeTruthy();
  });

  it('states the totals and the tier breakdown', () => {
    const txt = llmsTxt(manifest, slices);
    expect(txt).toContain('15,628 players');
    expect(txt).toContain('18,900 partnerships');
    expect(txt).toContain('FIVB World Tour: 1,517 tournaments');
  });

  it('links every published page and the raw JSON endpoints', () => {
    const txt = llmsTxt(manifest, slices);
    expect(txt).toContain('[Brazil Men](');
    expect(txt).toContain('[Norway Women](');
    expect(txt).toContain('/v1/manifest.json');
  });

  it('spells out the counting rules a model would otherwise guess wrong', () => {
    const txt = llmsTxt(manifest, slices);
    expect(txt).toMatch(/counts once/);
    expect(txt).toMatch(/not their partner count/);
    expect(txt).toMatch(/same federation/);
  });
});

describe('jsonLd', () => {
  it('cannot be closed early by a crafted string', () => {
    const html = jsonLd({ name: '</script><img onerror=alert(1)>' });
    expect(html).not.toContain('</script><img');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('stays valid JSON after escaping', () => {
    const html = jsonLd({ name: 'a < b', n: 1 });
    const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(body)).toEqual({ name: 'a < b', n: 1 });
  });
});
