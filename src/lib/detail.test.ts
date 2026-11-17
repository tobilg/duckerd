import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createERD } from '../commands/erd';
import { INFERRED_RELATIONSHIPS_COMMENT } from './inference';
import { generateMermaidCodeForAllDBs, type Constraint, type Metadata, type Table } from './metadata';
import { renderERD } from './render';

const table = (name: string, columns: Record<string, string>, constraints: Constraint[] = []): Table => ({
  name, databaseName: 'db', schemaName: 'main', hasPrimaryKey: false, estimatedRowCount: 0,
  columnCount: Object.keys(columns).length, indexCount: 0, checkConstraintCount: 0, sql: '', constraints,
  columns: Object.entries(columns).map(([name, dataType]) => ({ name, dataType, precision: 0, scale: 0, isNullable: true })),
});
const pk = (columnName: string): Constraint => ({ columnName, constraintType: 'PRIMARY KEY', sql: `PRIMARY KEY(${columnName})` });
const fk = (columnName: string, target: string): Constraint => ({
  columnName, constraintType: 'FOREIGN KEY', referencedTable: target, sql: `FOREIGN KEY (${columnName}) REFERENCES ${target}(id)`,
});
const metadata = (...tables: Table[]): Metadata => ({ databases: [{ name: 'db', schemas: [{ name: 'main', tables }] }] });

const declared = metadata(
  table('teams', { id: 'INTEGER', title: 'VARCHAR' }, [pk('id')]),
  table('people', { id: 'INTEGER', team_id: 'INTEGER', name: 'VARCHAR', full_name: 'STRUCT(given VARCHAR, family VARCHAR)' },
    [pk('id'), fk('team_id', 'teams')]),
  table('notes', { body: 'VARCHAR' }),
);

test('full detail is the default and keeps every column', () => {
  const source = generateMermaidCodeForAllDBs(declared)!;
  assert.equal(generateMermaidCodeForAllDBs(declared, false, false, undefined, 'full'), source);
  for (const column of ['id PK', 'title', 'team_id FK', 'name', 'full_name', 'body']) {
    assert.match(source, new RegExp(`\\b${column}\\b`));
  }
});

test('keys detail keeps only PK and FK columns and draws keyless tables as names', async () => {
  const source = generateMermaidCodeForAllDBs(declared, true, false, undefined, 'keys')!;
  assert.match(source, /"db\.teams" \{\n\s+INTEGER id PK\n\s+\}/);
  assert.match(source, /"db\.people" \{\n\s+INTEGER id PK\n\s+INTEGER team_id FK\n\s+\}/);
  assert.doesNotMatch(source, /title|\bname\b|full_name|body/);
  assert.match(source, /^\s*"db\.notes"$/m);
  assert.match(source, /"db\.teams" \|\|--o\{ "db\.people" : ""$/m);
  const svg = (await renderERD(source, { format: 'svg', theme: 'default' })).toString();
  assert.match(svg, />team_id<\/text>/);
  assert.match(svg, />db\.notes<\/text>/);
});

test('keys detail keeps columns behind inferred relationships', () => {
  const source = generateMermaidCodeForAllDBs(metadata(
    table('orders', { ORDER_ID: 'INTEGER', status: 'VARCHAR', customer_id: 'VARCHAR' }),
    table('lineitem', { order_id: 'INTEGER', quantity: 'INTEGER' }),
  ), false, true, undefined, 'keys')!;
  assert.ok(source.includes(INFERRED_RELATIONSHIPS_COMMENT));
  assert.match(source, /INTEGER ORDER_ID/);
  assert.match(source, /INTEGER order_id/);
  assert.doesNotMatch(source, /status|quantity|customer_id/);
  assert.match(source, /inferred: order_id \(unknown\)/);
});

test('names detail draws every table without attributes but keeps relationships', async () => {
  const source = generateMermaidCodeForAllDBs(declared, false, false, undefined, 'names')!;
  assert.doesNotMatch(source, /\{\s*$|^\s*\}|INTEGER|VARCHAR/m);
  for (const name of ['teams', 'people', 'notes']) assert.match(source, new RegExp(`^\\s*"db\\.${name}"$`, 'm'));
  assert.match(source, /"db\.teams" \|\|--o\{ "db\.people" : ""$/m);
  const svg = (await renderERD(source, { format: 'svg', theme: 'default' })).toString();
  assert.match(svg, />db\.people<\/text>/);
  assert.match(svg, /class="pele-marker"/);
  assert.doesNotMatch(svg, />INTEGER<\/text>/);
});

test('key columns match their constraints case-insensitively, as DuckDB identifiers do', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'duckerd-case-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'case.duckdb');
  const instance = await DuckDBInstance.create(database);
  const connection = await instance.connect();
  try {
    // DuckDB reports constraint columns as spelled in the constraint, not the column definition.
    await connection.run(`
      CREATE TABLE people ("PersonID" INTEGER, PRIMARY KEY (personid));
      CREATE TABLE contacts ("MemberID" INTEGER, note VARCHAR, FOREIGN KEY (memberid) REFERENCES people (personid));
      CREATE TABLE badges (holder INTEGER, PRIMARY KEY ("HOLDER"), FOREIGN KEY ("HOLDER") REFERENCES people ("PERSONID"));
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  for (const detail of ['keys', 'full'] as const) {
    const source = (await createERD(database, false, false, undefined, detail))!;
    assert.match(source, /"case\.people" \{\n\s+INTEGER PersonID PK\n\s+\}/, detail);
    assert.match(source, /"case\.contacts" \{\n\s+INTEGER MemberID FK\n/, detail);
    assert.match(source, /"case\.badges" \{\n\s+INTEGER holder PK,FK\n\s+\}/, detail);
  }
  assert.doesNotMatch((await createERD(database, false, false, undefined, 'keys'))!, /\bnote\b/);
});
