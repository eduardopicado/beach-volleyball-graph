import { describe, expect, it } from 'vitest';
import { esc, jsonLd } from './prerender.js';

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
