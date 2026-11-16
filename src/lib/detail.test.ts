import assert from 'node:assert/strict';
import { test } from 'node:test';
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
