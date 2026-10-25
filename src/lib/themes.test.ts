import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { colorNames, loadTheme, parseTheme, resolveTheme } from './themes';

test('theme JSON accepts partial definitions and normalizes colors and font lists', () => {
  assert.deepEqual(parseTheme('{}'), {});
  assert.deepEqual(parseTheme('\uFEFF{"colors":{"background":"#AbC","accent":"#ABCDEF"},"fontFamily":"  Arial,  sans-serif  ","fontSize":18.5,"borderRadius":0}'), {
    colors: { background: '#aabbcc', accent: '#abcdef' },
    fontFamily: 'Arial, sans-serif', fontSize: 18.5, borderRadius: 0,
  });
});

test('theme colors merge individually in preset, file, inline order without mutating presets', () => {
  const baseline = resolveTheme('dark');
  const merged = resolveTheme('dark',
    parseTheme('{"colors":{"background":"#123456","surface":"#234567"},"fontFamily":"Arial","fontSize":20,"borderRadius":8}'),
    parseTheme('{"colors":{"surface":"#345678"},"fontSize":24,"borderRadius":0}'),
  );
  assert.deepEqual(merged, {
    colors: { ...baseline.colors, background: '#123456', surface: '#345678' },
    fontFamily: 'Arial', fontSize: 24, borderRadius: 0,
  });
  assert.deepEqual(resolveTheme('dark', parseTheme('{"colors":{}}')), baseline);
  assert.deepEqual(resolveTheme('dark'), baseline);
  assert.deepEqual(Object.keys(merged.colors), [...colorNames]);
});

test('theme validation rejects malformed input, unknown fields, and invalid values with context', () => {
  const cases: [string, RegExp][] = [
    ['', /valid JSON/], ['{', /valid JSON/], ['null', /JSON object/], ['[]', /JSON object/], ['"dark"', /JSON object/],
    ['{"colors":null}', /colors must be an object/], ['{"colors":[]}', /colors must be an object/],
    ['{"colors":{"backgound":"#fff"}}', /unknown property colors.backgound/],
    ['{"colors":{"background":"red"}}', /colors.background.*hex color/],
    ['{"colors":{"surface":"#12345"}}', /colors.surface.*hex color/],
    ['{"colors":{"accent":123}}', /colors.accent.*hex color/],
    ['{"fontSize":"16"}', /fontSize.*positive number/], ['{"fontSize":0}', /fontSize.*positive number/],
    ['{"fontSize":-1}', /fontSize.*positive number/], ['{"fontSize":1e999}', /fontSize.*finite/],
    ['{"borderRadius":-1}', /borderRadius.*non-negative/], ['{"borderRadius":"4px"}', /borderRadius.*number in pixels/],
    ['{"borderRadius":null}', /borderRadius.*number/],
    ['{"fontFamily":[]}', /fontFamily/], ['{"fontFamily":" "}', /fontFamily/],
    ['{"fontFamily":"Arial;fill:red"}', /fontFamily/], ['{"fontFamily":"var(--font)"}', /fontFamily/],
    ['{"fontFamily":"Arial, "}', /fontFamily/], ['{"fontFamily":"<script>"}', /fontFamily/],
    ['{"fontWeight":700}', /unknown property fontWeight/],
    ['{"__proto__":{"polluted":true}}', /unknown property __proto__/],
    ['{"colors":{"constructor":"#fff"}}', /unknown property colors.constructor/],
  ];
  for (const [json, message] of cases) {
    assert.throws(() => parseTheme(json, 'theme file "bad.json"'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /theme file "bad.json"/);
      assert.match(error.message, message);
      return true;
    }, json);
  }
});

test('theme loader reads a file and applies inline overrides last', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'duckerd-theme-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'my theme.json');
  await writeFile(file, '{"colors":{"background":"#102030","surface":"#405060"},"fontSize":18}');
  const theme = await loadTheme({ theme: 'dark', themeFile: file, themeJson: '{"colors":{"surface":"#fff"}}' });
  assert.equal(theme.colors.background, '#102030');
  assert.equal(theme.colors.surface, '#ffffff');
  assert.equal(theme.colors.foreground, resolveTheme('dark').colors.foreground);
  assert.equal(theme.fontSize, 18);
  assert.deepEqual(await loadTheme({}), resolveTheme());

  await assert.rejects(loadTheme({ themeFile: path.join(directory, 'missing.json') }), /Cannot read theme file.*missing.json/);
  await writeFile(file, 'not JSON');
  await assert.rejects(loadTheme({ themeFile: file, themeJson: '{}' }), /Invalid theme in theme file.*my theme.json.*valid JSON/);
  await assert.rejects(loadTheme({ themeJson: '' }), /Invalid theme in --theme-json/);
});

test('documented example is a valid theme definition', async () => {
  const json = await readFile(path.resolve(__dirname, '../../docs/themes/brand.json'), 'utf8');
  const theme = resolveTheme('dark', parseTheme(json));
  assert.equal(theme.colors.background, '#101820');
  assert.equal(theme.fontSize, 16);
  assert.equal(theme.borderRadius, 8);
});
