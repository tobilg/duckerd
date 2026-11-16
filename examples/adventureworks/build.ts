/**
 * Creates an empty AdventureWorks database (schema only) from schema.sql.
 *
 *   npx tsx examples/adventureworks/build.ts [output.duckdb]
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'adventureworks.duckdb');
if (existsSync(output)) rmSync(output);

(async () => {
  const instance = await DuckDBInstance.create(output);
  const connection = await instance.connect();
  try {
    await connection.run(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const tables = await connection.runAndReadAll('SELECT count(*) FROM duckdb_tables()');
    const keys = await connection.runAndReadAll("SELECT count(*) FROM duckdb_constraints() WHERE constraint_type = 'FOREIGN KEY'");
    console.log(`${output}: ${tables.getRows()[0][0]} tables, ${keys.getRows()[0][0]} foreign keys`);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
})();
