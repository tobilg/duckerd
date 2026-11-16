import * as fontkit from 'fontkit';
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

/** Measures text with the bundled font's advance widths, including kerning. */
export const bundledFontMeasurer = (): TextMeasurer => {
  const font = loadBundledFont();
  const widths = new Map<string, number>();
  return {
    width(text, size, style) {
      if (style & MONO_STYLE) return text.length * size * 0.6;
      let units = widths.get(text);
      if (units === undefined) widths.set(text, units = font.layout(text).advanceWidth);
      return units / font.unitsPerEm * size;
    },
  };
};

const decodeEntities = (text: string): string => text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi,
  (_, decimal: string, hex: string, name: string) => decimal ? String.fromCodePoint(Number(decimal))
    : hex ? String.fromCodePoint(parseInt(hex, 16))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()]);

/**
 * An @font-face rule embedding the bundled font, subset to printable ASCII plus
 * every character in the SVG's text, so SVG viewers render the same font the
 * layout was measured with.
 */
export const embeddedFontFace = (svg: string): string => {
  const font = loadBundledFont();
  const text = decodeEntities(svg.replace(/<[^>]*>/g, ''));
  const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
  const subset = font.createSubset();
  for (const glyph of font.glyphsForString(ascii + text)) subset.includeGlyph(glyph);
  const data = Buffer.from(subset.encode()).toString('base64');
  return `@font-face{font-family:'${BUNDLED_FONT_FAMILY}';src:url(data:font/ttf;base64,${data}) format('truetype');}`;
};
