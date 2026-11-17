import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createERD } from '../commands/erd';

const directory = mkdtempSync(path.join(tmpdir(), 'duckerd-fk-'));
const database = path.join(directory, 'keys.duckdb');
const sameName = path.join(directory, 'samename.duckdb');

const create = async (file: string, sql: string): Promise<void> => {
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  try {
    await connection.run(sql);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
};

before(async () => {
  // DuckDB quotes keyword table names such as Location in constraint_text.
  await create(database, `
    CREATE TABLE "Location" (id INTEGER PRIMARY KEY);
    CREATE TABLE pair (a INTEGER, b INTEGER, PRIMARY KEY (a, b));
    CREATE TABLE child (
      id INTEGER PRIMARY KEY,
      location_id INTEGER REFERENCES "Location"(id),
      a INTEGER, b INTEGER,
      FOREIGN KEY (a, b) REFERENCES pair(a, b)
    );
    CREATE SCHEMA sales;
    CREATE TABLE sales.employee (id INTEGER PRIMARY KEY, manager_id INTEGER REFERENCES sales.employee(id));
  `);
  await create(sameName, `
    CREATE SCHEMA crm; CREATE SCHEMA billing;
    CREATE TABLE crm.users (id INTEGER PRIMARY KEY, email VARCHAR);
    CREATE TABLE crm.tickets (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES crm.users(id));
    CREATE TABLE billing.users (id INTEGER PRIMARY KEY, iban VARCHAR);
    CREATE TABLE billing.invoices (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES billing.users(id));
  `);
});

after(() => rmSync(directory, { recursive: true, force: true }));

test('foreign keys use the referenced table name, once per constraint', async () => {
  const source = (await createERD(database))!;
  const edges = source.split('\n').map((line) => line.trim()).filter((line) => line.includes('||--o{'));
  assert.deepEqual(edges.sort(), [
    '"keys.Location" ||--o{ "keys.child" : ""',
    '"keys.employee" ||--o{ "keys.employee" : ""',
    '"keys.pair" ||--o{ "keys.child" : ""',
  ]);
});

test('same-named tables in different schemas stay separate entities', async () => {
  const source = (await createERD(sameName))!;
  assert.match(source, /"samename\.crm\.users" \{\n\s+INTEGER id PK\n\s+VARCHAR email \n\s+\}/);
  assert.match(source, /"samename\.billing\.users" \{\n\s+INTEGER id PK\n\s+VARCHAR iban \n\s+\}/);
  assert.doesNotMatch(source, /"samename\.users"/);
  const edges = source.split('\n').map((line) => line.trim()).filter((line) => line.includes('||--o{'));
  assert.deepEqual(edges.sort(), [
    '"samename.billing.users" ||--o{ "samename.invoices" : ""',
    '"samename.crm.users" ||--o{ "samename.tickets" : ""',
  ]);
});
