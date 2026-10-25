import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { renderERD, themeNames } from './render';
import { parseTheme, resolveTheme } from './themes';

const pdfDrawingCommands = (pdf: Buffer): string => [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
  .map((match) => inflateSync(Buffer.from(match[1], 'latin1')).toString()).join('\n');

const firstPngPixel = (png: Buffer): Buffer => {
  assert.equal(png[24], 8, '8-bit PNG');
  assert.ok(png[25] === 2 || png[25] === 6, 'RGB or RGBA PNG');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  // All PNG row filters predict zero for the very first pixel.
  return inflateSync(Buffer.concat(chunks)).subarray(1, 4);
};

const source = `erDiagram
  teams {
    INTEGER id PK
  }
  people {
    INTEGER id PK
    INTEGER team_id FK
    VARCHAR name
    ENUM status "active, inactive"
  }
  teams ||--o{ people : has`;

test('Pele renders entities, attributes, and relationships as standalone SVG', async () => {
  const svg = (await renderERD(source, { format: 'svg', theme: 'default', width: 640, height: 480 })).toString();
  assert.match(svg, /^<svg[^>]*width="640" height="480"/);
  assert.match(svg, /class="pele pele-er"/);
  assert.match(svg, /data-id="people"/);
  assert.match(svg, /class="pele-edge /);
  for (const label of ['teams', 'people', 'team_id', 'PK', 'FK', 'active, inactive']) {
    assert.ok(svg.includes(`>${label}</text>`), label);
  }
  assert.doesNotMatch(svg, /var\(/);
});

test('all named palettes resolve to fixed colors, including PNG backgrounds', async () => {
  const colors = new Set<string>();
  for (const theme of themeNames) {
    const svg = (await renderERD(source, { format: 'svg', theme, width: 320, height: 240 })).toString();
    assert.doesNotMatch(svg, /var\(/);
    colors.add(svg.match(/--_s:([^;]+)/)![1]);
    const png = await renderERD(source, { format: 'png', theme, width: 320, height: 240 });
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 320);
    assert.equal(png.readUInt32BE(20), 240);
    assert.ok(png.length > 1000, 'PNG contains diagram content');
  }
  assert.equal(colors.size, themeNames.length);
});

test('CSS-like label text is preserved when applying a palette', async () => {
  const svg = (await renderERD('erDiagram\n sample {\n VARCHAR value "var(--_bg)"\n }', {
    format: 'svg', theme: 'dark', width: 320, height: 240,
  })).toString();
  assert.match(svg, />var\(--_bg\)<\/text>/);
  assert.match(svg, /fill="#1f1f1f"/);
});

test('PDF export retains vector graphics and the requested page dimensions', async () => {
  const pdf = await renderERD(source, { format: 'pdf', theme: 'dark', width: 640, height: 480 });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 640 480\]/);
  assert.doesNotMatch(pdf.toString('latin1'), /\/Subtype \/Image/);
  assert.match(pdf.toString('latin1'), /%%EOF/);
});

test('rendering errors propagate to the caller', async () => {
  await assert.rejects(renderERD('not a diagram', { format: 'svg', theme: 'default', width: 320, height: 240 }));
});

test('custom colors, fonts, and rounded corners survive SVG, PNG, and PDF export', async () => {
  const theme = resolveTheme('dark', parseTheme(JSON.stringify({
    colors: {
      background: '#ff0000', foreground: '#ffffff', muted: '#00ff00', line: '#0000ff',
      surface: '#00ffff', surfaceAlt: '#ff00ff', border: '#000000', accent: '#ffff00',
    },
    fontFamily: 'monospace', fontSize: 24, borderRadius: 12,
  })));
  const options = { theme, width: 640, height: 480 };
  const svg = (await renderERD(source, { ...options, format: 'svg' })).toString();
  assert.match(svg, /font:24px/);
  assert.match(svg, /font-family:monospace/);
  assert.match(svg, /<svg[^>]*class="pele pele-er"[^>]*fill="#ffffff"/);
  assert.match(svg, /class="pele-edges"[^>]*stroke="#0000ff"/);
  assert.match(svg, /class="pele-er-type"[^>]*fill="#00ff00"/);
  assert.match(svg, /<rect[^>]*fill="#00ffff"[^>]*stroke="#000000"[^>]*rx="12px"/);
  assert.match(svg, /class="pele-er-stripes" fill="#ff00ff"/);
  assert.match(svg, /class="pele-er-keys"[^>]*fill="#ffff00"/);
  assert.doesNotMatch(svg, /var\(|style="rx:/);
  const baselineSvg = (await renderERD(source, { ...options, theme: 'dark', format: 'svg' })).toString();
  const naturalViewBox = (text: string) => text.match(/class="pele pele-er" viewBox="([^"]*)"/)![1];
  assert.notEqual(naturalViewBox(svg), naturalViewBox(baselineSvg), 'font size changes layout before canvas fitting');

  const png = await renderERD(source, { ...options, format: 'png' });
  assert.deepEqual(firstPngPixel(png), Buffer.from([255, 0, 0]));
  const pdf = await renderERD(source, { ...options, format: 'pdf' });
  const commands = pdfDrawingCommands(pdf);
  for (const color of ['1 0 0 scn', '1 1 1 scn', '0 1 0 scn', '0 0 1 SCN', '0 1 1 scn', '1 0 1 scn', '0 0 0 SCN', '1 1 0 scn']) {
    assert.ok(commands.includes(color), `PDF uses ${color}`);
  }
  assert.doesNotMatch(pdf.toString('latin1'), /\/Subtype \/Image/);
});

test('borderRadius changes exported geometry, including zero for square corners', async () => {
  // Empty entities isolate corner geometry from glyph outlines and arrowheads.
  const entity = 'erDiagram\nbox {}';
  const options = { width: 320, height: 240 };
  const square = resolveTheme('default', { borderRadius: 0 });
  const rounded = resolveTheme('default', { borderRadius: 16 });
  const svg = (await renderERD(entity, { ...options, format: 'svg', theme: square })).toString();
  assert.match(svg, /rx="0px"/);
  const squarePng = await renderERD(entity, { ...options, format: 'png', theme: square });
  const roundedPng = await renderERD(entity, { ...options, format: 'png', theme: rounded });
  assert.notDeepEqual(squarePng, roundedPng);
  const squarePdf = pdfDrawingCommands(await renderERD(entity, { ...options, format: 'pdf', theme: square }));
  const roundedPdf = pdfDrawingCommands(await renderERD(entity, { ...options, format: 'pdf', theme: rounded }));
  assert.notEqual(squarePdf, roundedPdf);
});
