import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { renderERD } from '../lib/render';

const directory = mkdtempSync(path.join(tmpdir(), 'duckerd-pele-'));
const database = path.join(directory, 'sample data.duckdb');
const inferenceDatabase = path.join(directory, 'inference.duckdb');
const cli = path.resolve(__dirname, '../index.ts');
const loader = require.resolve('tsx');
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', loader, cli, ...args], {
  cwd: directory,
  encoding: 'utf8',
  timeout: 30_000,
  // Rendering must work without npm, a browser executable, or registry access.
  env: { ...process.env, PATH: directory, npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:9' },
});

before(async () => {
  const instance = await DuckDBInstance.create(database);
  const connection = await instance.connect();
  try {
    await connection.run(`
      CREATE TABLE teams (id INTEGER PRIMARY KEY);
      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id),
        full_name STRUCT(given VARCHAR, family VARCHAR),
        status ENUM('active', 'inactive'),
        attributes MAP(VARCHAR, VARCHAR),
        score DECIMAL(8,2)
      );
      CREATE TABLE orders (order_id INTEGER);
      CREATE TABLE lineitem (order_id INTEGER);
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
});

before(async () => {
  const instance = await DuckDBInstance.create(inferenceDatabase);
  const connection = await instance.connect();
  try {
    await connection.run(`
      CREATE TABLE orders (ORDER_ID INTEGER, customer_key VARCHAR, details STRUCT(region_id INTEGER), status VARCHAR);
      CREATE TABLE lineitem (order_id INTEGER, CUSTOMER_KEY VARCHAR, details STRUCT(region_id INTEGER), status VARCHAR);
      CREATE TABLE notes (order_id INTEGER);
      CREATE SCHEMA archive;
      CREATE TABLE archive.orders (order_id INTEGER);
      CREATE TABLE archive.lines (order_id INTEGER);
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
});

after(() => rmSync(directory, { recursive: true, force: true }));

test('CLI renders SVG and saves expanded source without a temporary source file or npm', () => {
  const output = path.join(directory, 'diagram ; test.svg');
  const source = path.join(directory, 'saved source.mmd');
  const result = run('-d', database, '-o', output, '-m', source, '-e', '-t', 'forest', '-w', '800', '-H', '600');
  assert.equal(result.status, 0, result.stderr);
  const svg = readFileSync(output, 'utf8');
  for (const label of ['full_name__given', 'full_name__family', 'team_id', 'active, inactive', 'DECIMAL(8_2)', 'MAP']) {
    assert.ok(svg.includes(`>${label}</text>`), label);
  }
  assert.match(svg, /class="pele pele-er"/);
  assert.match(svg, /width="800" height="600"/);
  assert.match(readFileSync(source, 'utf8'), /^erDiagram/);
  assert.equal(existsSync(path.join(directory, 'schema_erd.mmd')), false);
});

test('CLI preserves default PNG output and leaves existing schema_erd.mmd files alone', () => {
  const sentinel = path.join(directory, 'schema_erd.mmd');
  writeFileSync(sentinel, 'existing source');
  const result = run('-d', database);
  assert.equal(result.status, 0, result.stderr);
  const png = readFileSync(path.join(directory, 'sample data_erd.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 768);
  assert.equal(readFileSync(sentinel, 'utf8'), 'existing source');
});

test('CLI supports explicit PDF output format', () => {
  const result = run('-d', database, '-f', 'pdf');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(directory, 'sample data_erd.pdf')).subarray(0, 5).toString(), '%PDF-');
});

test('CLI reports an empty database without producing output', () => {
  const result = run('-d', ':memory:', '-o', 'empty.svg');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No tables found/);
  assert.equal(existsSync(path.join(directory, 'empty.svg')), false);
});

test('CLI reports invalid options, missing databases, and write failures with nonzero status', () => {
  for (const args of [
    ['-d', 'missing.duckdb'],
    ['-w', '0'],
    ['-H', 'not-a-number'],
    ['-t', 'invalid'],
    ['-f', 'jpeg'],
    ['-o', 'diagram.jpeg'],
    ['-d', database, '-o', 'same.svg', '-m', 'same.svg'],
    ['-d', database, '-o', 'missing-directory/diagram.svg'],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /error/i);
  }
});

test('CLI merges a theme file with inline JSON in all output formats without npm', () => {
  writeFileSync(path.join(directory, 'brand theme.json'), JSON.stringify({
    colors: { background: '#102030', surface: '#405060', accent: '#fedcba' },
    fontFamily: 'monospace', fontSize: 20, borderRadius: 10,
  }));
  for (const format of ['svg', 'png', 'pdf']) {
    const output = `custom.${format}`;
    const result = run('-d', database, '--theme', 'dark', '--theme-file', 'brand theme.json',
      '--theme-json', '{"colors":{"surface":"#abcdef"},"borderRadius":0}', '-o', output);
    assert.equal(result.status, 0, result.stderr);
    const content = readFileSync(path.join(directory, output));
    if (format === 'svg') {
      const svg = content.toString();
      assert.match(svg, /fill="#102030"/);
      assert.match(svg, /fill="#abcdef"/);
      assert.match(svg, /fill="#fedcba"/);
      assert.match(svg, /fill="#eeeeee"/);
      assert.match(svg, /font:20px/);
      assert.match(svg, /font-family:monospace/);
      assert.match(svg, /rx="0px"/);
    } else if (format === 'png') {
      assert.equal(content.subarray(1, 4).toString(), 'PNG');
    } else {
      assert.equal(content.subarray(0, 5).toString(), '%PDF-');
    }
  }
});

test('invalid themes fail before rendering and preserve existing output files', () => {
  writeFileSync(path.join(directory, 'bad theme.json'), '{"fontSize":-1}');
  const output = path.join(directory, 'preserved.svg');
  writeFileSync(output, 'existing diagram');
  const cases: [string[], RegExp][] = [
    [['--theme-file', 'missing.json'], /Cannot read theme file.*missing.json/],
    [['--theme-file', 'bad theme.json'], /bad theme.json.*fontSize/],
    [['--theme-json', '{'], /--theme-json.*valid JSON/],
    [['--theme-json', '{"colors":{"surfase":"#fff"}}'], /colors.surfase/],
    [['--theme-json', '{"fontFamily":"Arial;fill:red"}'], /fontFamily/],
    [['--theme-json', '{"borderRadius":-2}'], /borderRadius/],
  ];
  for (const [args, message] of cases) {
    const result = run('-d', database, '-o', output, ...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /Generating ERD/);
    assert.equal(readFileSync(output, 'utf8'), 'existing diagram');
  }
  const empty = run('--theme-json', '{"colors":{"background":"blue"}}');
  assert.equal(empty.status, 1, 'invalid theme is rejected even with an empty database');
});

test('CLI inference is opt-in, scopes links to schemas, and preserves saved-source rendering', async () => {
  const baseline = run('-d', inferenceDatabase, '-o', 'not-inferred.svg', '-m', 'not-inferred.mmd');
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.doesNotMatch(readFileSync(path.join(directory, 'not-inferred.mmd'), 'utf8'), /inferred|}o\.\.o\{/);

  const result = run('-d', inferenceDatabase, '--infer', '-e', '-o', 'inferred.svg', '-m', 'inferred.mmd');
  assert.equal(result.status, 0, result.stderr);
  const source = readFileSync(path.join(directory, 'inferred.mmd'), 'utf8');
  assert.match(source, /^\s*%% duckerd:inferred-relationships$/m);
  assert.equal(source.match(/}o\.\.o\{/g)?.length, 4, 'three main-schema pairs plus one archive pair');
  assert.match(source, /"inference.archive.lines"|"inference.lines"/);
  assert.match(source, /"inference.archive.orders"/);
  assert.match(source, /"inference.main.orders"/);
  assert.doesNotMatch(source, /\bFK\b|inferred:.*(?:region_id|customer_key|status)/i);
  const svg = readFileSync(path.join(directory, 'inferred.svg'), 'utf8');
  assert.match(svg, />details__region_id<\/text>/);
  assert.match(svg, />inferred: order_id \(unknown\)<\/text>/);
  assert.doesNotMatch(svg, /class="pele-marker"/);
  assert.equal(svg, (await renderERD(source, { format: 'svg', theme: 'default', width: 1024, height: 768 })).toString());
});

test('CLI custom inference regex replaces the default in SVG, PNG, and PDF', () => {
  for (const format of ['svg', 'png', 'pdf']) {
    const output = `inferred-key.${format}`;
    const result = run('-d', inferenceDatabase, '--infer', '--infer-regex', '^customer_key$', '-o', output, '-m', 'inferred-key.mmd');
    assert.equal(result.status, 0, result.stderr);
    const source = readFileSync(path.join(directory, 'inferred-key.mmd'), 'utf8');
    assert.equal(source.match(/}o\.\.o\{/g)?.length, 1);
    assert.match(source, /inferred: CUSTOMER_KEY \(unknown\)/);
    assert.doesNotMatch(source, /inferred:.*order_id/i);
    const content = readFileSync(path.join(directory, output));
    if (format === 'svg') {
      assert.match(content.toString(), /stroke-dasharray="4 3"/);
      assert.doesNotMatch(content.toString(), /class="pele-marker"/);
    } else {
      assert.equal(format === 'png' ? content.subarray(1, 4).toString() : content.subarray(0, 5).toString(), format === 'png' ? 'PNG' : '%PDF-');
    }
  }
});

test('CLI suppresses inference globally when unrelated declared foreign keys exist', () => {
  for (const [name, args] of [['baseline', []], ['enabled', ['--infer', '--infer-regex', '.*']]] as const) {
    const result = run('-d', database, ...args, '-o', `fk-${name}.svg`, '-m', `fk-${name}.mmd`);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const extension of ['svg', 'mmd']) {
    assert.deepEqual(readFileSync(path.join(directory, `fk-enabled.${extension}`)), readFileSync(path.join(directory, `fk-baseline.${extension}`)));
  }
  assert.match(readFileSync(path.join(directory, 'fk-enabled.svg'), 'utf8'), /class="pele-marker"/);
});

test('CLI handles inference with no matching columns or no tables', () => {
  const noMatches = run('-d', inferenceDatabase, '--infer', '--infer-regex', '^missing$', '-o', 'no-matches.svg', '-m', 'no-matches.mmd');
  assert.equal(noMatches.status, 0, noMatches.stderr);
  assert.doesNotMatch(readFileSync(path.join(directory, 'no-matches.mmd'), 'utf8'), /inferred|}o\.\.o\{/);
  const empty = run('-d', ':memory:', '--infer', '-o', 'empty-inferred.svg', '-m', 'empty-inferred.mmd');
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /No tables found/);
  assert.equal(existsSync(path.join(directory, 'empty-inferred.svg')), false);
  assert.equal(existsSync(path.join(directory, 'empty-inferred.mmd')), false);
});

test('CLI validates inference regex and flag dependency before touching outputs or databases', () => {
  const output = path.join(directory, 'inference-preserved.svg');
  const source = path.join(directory, 'inference-preserved.mmd');
  writeFileSync(output, 'existing diagram');
  writeFileSync(source, 'existing source');
  const cases: [string[], RegExp][] = [
    [['-d', inferenceDatabase, '--infer', '--infer-regex', '['], /Invalid --infer-regex:.*Unterminated character class/],
    [['-d', database, '--infer', '--infer-regex', '('], /Invalid --infer-regex:.*Unterminated group/],
    [['-d', ':memory:', '--infer', '--infer-regex', '*'], /Invalid --infer-regex:.*Nothing to repeat/],
    [['-d', 'missing.duckdb', '--infer', '--infer-regex', '['], /Invalid --infer-regex/],
    [['--infer-regex', '_key$'], /--infer-regex requires --infer/],
    [['--infer', '--infer-regex'], /argument missing/],
  ];
  for (const [args, error] of cases) {
    const result = run('-o', output, '-m', source, ...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stdout, /Generating ERD/);
    assert.equal(readFileSync(output, 'utf8'), 'existing diagram');
    assert.equal(readFileSync(source, 'utf8'), 'existing source');
  }
});
