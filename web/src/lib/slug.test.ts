import { describe, expect, it } from 'vitest';
import { sliceSlug, slicePath, slugFromPath, slugify } from './slug';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('United States')).toBe('united-states');
  });
  it('strips diacritics rather than dropping the letters', () => {
    expect(slugify('Côte d’Ivoire')).toBe('cote-d-ivoire');
    expect(slugify('Türkiye')).toBe('turkiye');
  });
  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugify('  Congo - Brazzaville!  ')).toBe('congo-brazzaville');
  });
});

describe('sliceSlug', () => {
  it('appends a readable gender', () => {
    expect(sliceSlug('Brazil', 'M')).toBe('brazil-men');
    expect(sliceSlug('Brazil', 'W')).toBe('brazil-women');
  });
});

describe('slicePath', () => {
  it('honours the deploy base', () => {
    expect(slicePath('/', 'Norway', 'M')).toBe('/norway-men/');
    expect(slicePath('/repo/', 'Norway', 'M')).toBe('/repo/norway-men/');
  });
});

describe('slugFromPath', () => {
  it('round-trips a slice path', () => {
    const path = slicePath('/repo/', 'Brazil', 'W');
    expect(slugFromPath(path, '/repo/')).toBe(sliceSlug('Brazil', 'W'));
  });

  it('returns null at the site root', () => {
    expect(slugFromPath('/', '/')).toBeNull();
    expect(slugFromPath('/repo/', '/repo/')).toBeNull();
    expect(slugFromPath('/repo/index.html', '/repo/')).toBeNull();
  });

  it('tolerates a missing trailing slash and an explicit index.html', () => {
    expect(slugFromPath('/brazil-men', '/')).toBe('brazil-men');
    expect(slugFromPath('/brazil-men/index.html', '/')).toBe('brazil-men');
  });

  it('does not mistake a base-less path for a slug-less root', () => {
    expect(slugFromPath('/norway-women/', '/')).toBe('norway-women');
  });
});
