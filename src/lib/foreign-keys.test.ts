import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createERD } from '../commands/erd';

const directory = mkdtempSync(path.join(tmpdir(), 'duckerd-fk-'));
const database = path.join(directory, 'keys.duckdb');

before(async () => {
  const instance = await DuckDBInstance.create(database);
  const connection = await instance.connect();
  try {
    // DuckDB quotes keyword table names such as Location in constraint_text.
    await connection.run(`
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
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
});

after(() => rmSync(directory, { recursive: true, force: true }));

test('foreign keys use the referenced table name, once per constraint', async () => {
  const source = (await createERD(database))!;
  const edges = source.split('\n').map((line) => line.trim()).filter((line) => line.includes('||--o{'));
  assert.deepEqual(edges.sort(), [
    '"keys.Location" ||--o{ "keys.child" : has',
    '"keys.employee" ||--o{ "keys.employee" : has',
    '"keys.pair" ||--o{ "keys.child" : has',
  ]);
});
