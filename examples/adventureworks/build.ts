/**
 * Creates an empty AdventureWorks database (schema only) from schema.sql.
 *
 *   npx tsx examples/adventureworks/build.ts [--force] [output.duckdb]
 *
 * An existing output file is left untouched unless --force is given.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
const force = args.includes('--force');
const files = args.filter((arg) => arg !== '--force');
if (files.length > 1 || files.some((arg) => arg.startsWith('-'))) {
  console.error('Usage: build.ts [--force] [output.duckdb]');
  process.exit(1);
}
const output = path.resolve(files[0] ?? 'adventureworks.duckdb');
if (existsSync(output)) {
  if (!force) {
    console.error(`${output} already exists. Pass --force to replace it.`);
    process.exit(1);
  }
  rmSync(output);
  // A leftover write-ahead log would be replayed into the new database.
  rmSync(`${output}.wal`, { force: true });
}

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
