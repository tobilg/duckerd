import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const directory = mkdtempSync(path.join(tmpdir(), 'duckerd-pele-'));
const database = path.join(directory, 'sample data.duckdb');
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
