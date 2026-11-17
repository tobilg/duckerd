import * as fontkit from 'fontkit';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * DuckERD ships IBM Plex Sans Condensed (SIL Open Font License, see fonts/OFL.txt)
 * so PNG and PDF output look the same on every OS, and so tables are sized from
 * the real glyph widths rather than generic estimates.
 */
export const BUNDLED_FONT_FAMILY = 'IBM Plex Sans Condensed';
// Resolves from both src/lib (tests) and dist/lib (published package).
export const BUNDLED_FONT_FILE = path.join(__dirname, '../../fonts/IBMPlexSansCondensed-Regular.ttf');

// Pele's style flag for monospace runs; ER diagrams do not currently use it.
const MONO_STYLE = 4;

let bundledFont: fontkit.Font | undefined;
const loadBundledFont = (): fontkit.Font => {
  if (!bundledFont) {
    const font = fontkit.openSync(BUNDLED_FONT_FILE);
    if (!('layout' in font)) throw new Error(`Unexpected font collection at ${BUNDLED_FONT_FILE}`);
    bundledFont = font;
  }
  return bundledFont;
};

/** Font names from a theme's comma-separated list, in order. */
const families = (fontFamily: string): string[] => fontFamily.split(',').map((name) => name.trim()).filter(Boolean);

export const usesBundledFont = (fontFamily: string): boolean =>
  families(fontFamily)[0]?.toLowerCase() === BUNDLED_FONT_FAMILY.toLowerCase();

export interface TextMeasurer {
  width(text: string, size: number, style: number): number;
}

// Pele's estimates for characters it has no metrics for, in thousandths of an em:
// wide East Asian characters (and astral characters, counted at their high
// surrogate) take a full em, combining and zero-width marks take none, and
// anything else takes 580.
const isWide = (code: number): boolean => (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
  || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f)
  || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0xd800 && code <= 0xdbff);
const isZeroWidth = (code: number): boolean => code === 0xad || (code >= 0x300 && code <= 0x36f)
  || (code >= 0x200b && code <= 0x200f) || (code >= 0xdc00 && code <= 0xdfff) || (code >= 0xfe00 && code <= 0xfe0f) || code === 0xfeff;
const fallbackUnits = (text: string): number => {
  let units = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 || isZeroWidth(code)) continue;
    units += isWide(code) ? 1000 : 580;
  }
  return units;
};

/**
 * Measures text with the bundled font's advance widths, including kerning.
 * Characters the font lacks are drawn by a fallback font whose widths are
 * unknown, so they use Pele's own estimates instead of the missing-glyph box.
 */
export const bundledFontMeasurer = (): TextMeasurer => {
  const font = loadBundledFont();
  const widths = new Map<string, number>();
  const measure = (text: string): number => {
    let units = 0;
    let run = '';
    let missing = false;
    const flush = () => {
      if (run) units += missing ? fallbackUnits(run) * font.unitsPerEm / 1000 : font.layout(run).advanceWidth;
      run = '';
    };
    for (const character of text) {
      const lacks = !font.hasGlyphForCodePoint(character.codePointAt(0)!);
      if (lacks !== missing) flush();
      missing = lacks;
      run += character;
    }
    flush();
    return units;
  };
  return {
    width(text, size, style) {
      if (style & MONO_STYLE) return text.length * size * 0.6;
      let units = widths.get(text);
      if (units === undefined) widths.set(text, units = measure(text));
      return units / font.unitsPerEm * size;
    },
  };
};

// IBM's WOFF2 build of the same font version (glyphs and metrics match the TTF).
const BUNDLED_FONT_WOFF2 = path.join(__dirname, '../../fonts/IBMPlexSansCondensed-Regular.woff2');
let fontFace: string | undefined;

/**
 * An @font-face rule embedding the whole bundled font as WOFF2 (about 49 KB of
 * base64), so SVG viewers render the same font the layout was measured with.
 */
export const embeddedFontFace = (): string => fontFace ??= `@font-face{font-family:'${BUNDLED_FONT_FAMILY}';`
  + `src:url(data:font/woff2;base64,${readFileSync(BUNDLED_FONT_WOFF2).toString('base64')}) format('woff2');}`;
