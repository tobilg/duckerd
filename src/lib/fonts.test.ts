import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fontkit from 'fontkit';
import { BUNDLED_FONT_FILE, bundledFontMeasurer } from './fonts';
import { renderERD } from './render';

const font = fontkit.openSync(BUNDLED_FONT_FILE) as fontkit.Font;
const plex = (text: string, size: number): number => font.layout(text).advanceWidth / font.unitsPerEm * size;

test('the measurer uses Plex widths with kerning, and Pele estimates for characters Plex lacks', () => {
  const { width } = bundledFontMeasurer();
  for (const text of ['AVATAR', 'Production.ProductModel', 'café ß € → ✓']) assert.equal(width(text, 14, 0), plex(text, 14), text);
  assert.ok(plex('AV', 14) < plex('A', 14) + plex('V', 14), 'kerning applies within a run');

  // A fallback font draws these: wide characters take an em, others 0.58 em,
  // instead of Plex's 0.424 em missing-glyph box.
  assert.equal(width('漢字'.repeat(18), 14, 0), 36 * 14);
  assert.equal(width('한글', 10, 0), 20);
  assert.equal(width('😀', 10, 0), 10, 'an astral character counts once');
  assert.ok(Math.abs(width('ЖΩ', 10, 0) - 11.6) < 1e-9);
  assert.ok(Math.abs(width('id 漢字 AV', 14, 0) - (plex('id ', 14) + 28 + plex(' AV', 14))) < 1e-9);
});

test('labels outside Plex coverage fit inside their tables', async () => {
  // An ENUM comment of 36 CJK characters, which Pele wraps across lines.
  const source = `erDiagram
  "db.items" {
      INTEGER id PK
      ENUM status "${'漢字'.repeat(18)}"
    }
`;
  const svg = (await renderERD(source, { format: 'svg', theme: 'default' })).toString();
  // Without width or height the canvas is the diagram's natural size, drawn at scale 1.
  const [, outerWidth, outerHeight] = svg.match(/^<svg[^>]*width="(\d+)" height="(\d+)"/)!.map(Number);
  const inner = svg.match(/<svg[^>]*class="pele pele-er"[^>]*width="([\d.]+)" height="([\d.]+)"/)!;
  assert.deepEqual([outerWidth, outerHeight], [Math.ceil(Number(inner[1])), Math.ceil(Number(inner[2]))]);
  assert.match(svg, /<g transform="translate\([\d.]+ [\d.]+\) scale\(1\)">/);
  const rect = svg.match(/<g class="pele-node pele-entity"[^>]*><rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/)!;
  const right = Number(rect[1]) + Number(rect[2]);
  const size = Number(svg.match(/<g class="pele-er-attributes" font-size="([\d.]+)"/)![1]);
  const lines = [...svg.matchAll(/<tspan x="([-\d.]+)"[^>]*>([^<]*)<\/tspan>/g)];
  assert.equal(lines.map(([, , text]) => text).join(''), '漢字'.repeat(18));
  for (const [, x, text] of lines) {
    // CJK fonts draw these characters a full em wide.
    assert.ok(Number(x) + [...text].length * size <= right, `"${text}" ends at ${Number(x) + [...text].length * size}, table at ${right}`);
  }
});
