#!/usr/bin/env node

import { Command } from 'commander';
import * as duckdb from 'duckdb';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';

const program = new Command();

program
  .version('1.0.0')
  .description('A CLI tool for DuckDB operations')
  .option('-d, --database <path>', 'Path to the database file')
  .option('-s, --schema <name>', 'Schema name');

program
  .command('erd')
  .description('Generate an ERD diagram of the database schema')
  .action((options: { database: string, schema: string }) => {
    const dbPath = options.database ? path.resolve(options.database) : ':memory:';
    const schema = options.schema;
    const db = new duckdb.Database(dbPath);

    const schemaQuery = `
      SELECT 
        c.table_catalog,
        c.table_schema,
        c.table_name, 
        c.column_name, 
        c.data_type,
        CASE WHEN pk.column_name IS NOT NULL THEN 'PK' ELSE '' END AS is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN fk.foreign_table_name ELSE '' END AS references_table,
        CASE WHEN fk.column_name IS NOT NULL THEN fk.foreign_column_name ELSE '' END AS references_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.table_catalog, kcu.table_schema, kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_catalog = kcu.table_catalog
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
        ${schema ? `AND tc.table_schema = '${schema}'` : ''}
      ) pk ON c.table_catalog = pk.table_catalog AND c.table_schema = pk.table_schema AND c.table_name = pk.table_name AND c.column_name = pk.column_name
      LEFT JOIN (
        SELECT 
          kcu.table_catalog,
          kcu.table_schema,
          kcu.table_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_catalog = kcu.table_catalog
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu 
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_catalog = tc.table_catalog
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        ${schema ? `AND tc.table_schema = '${schema}'` : ''}
      ) fk ON c.table_catalog = fk.table_catalog AND c.table_schema = fk.table_schema AND c.table_name = fk.table_name AND c.column_name = fk.column_name
      ${schema ? `WHERE c.table_schema = '${schema}'` : ''}
      ORDER BY c.table_catalog, c.table_schema, c.table_name, c.ordinal_position;
    `;

    db.all(schemaQuery, (err: Error | null, result: any[]) => {
      if (err) {
        console.error('Error querying schema:', err);
        //db.close();
        return;
      }

      const mermaidDiagram = generateMermaidDiagram(result);
      const mermaidFile = 'schema_erd.mmd';
      fs.writeFileSync(mermaidFile, mermaidDiagram);

      exec(`npx mmdc -i ${mermaidFile} -o schema_erd.png`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error generating ERD: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`ERD generation stderr: ${stderr}`);
          return;
        }
        console.log('ERD diagram generated: schema_erd.png');
        fs.unlinkSync(mermaidFile);
        //db.close();
      });
    });
  });

function generateMermaidDiagram(schemaData: any[]): string {
  let mermaidCode = 'erDiagram\n';
  const tables: { [key: string]: string[] } = {};
  const relationships: Set<string> = new Set();

  schemaData.forEach((row) => {
    const fullTableName = `${row.table_catalog}.${row.table_schema}.${row.table_name}`;
    if (!tables[fullTableName]) {
      tables[fullTableName] = [];
    }
    const pkIndicator = row.is_primary_key ? ' PK' : '';
    tables[fullTableName].push(`${row.column_name} ${row.data_type}${pkIndicator}`);

    if (row.references_table) {
      const fullReferencesTable = `${row.table_catalog}.${row.table_schema}.${row.references_table}`;
      relationships.add(`${fullTableName} }|--|| ${fullReferencesTable} : "${row.column_name}"`);
    }
  });

  for (const [tableName, columns] of Object.entries(tables)) {
    mermaidCode += `  "${tableName}" {\n`;
    columns.forEach((column) => {
      mermaidCode += `    ${column}\n`;
    });
    mermaidCode += '  }\n';
  }

  relationships.forEach((relationship) => {
    mermaidCode += `  ${relationship}\n`;
  });

  return mermaidCode;
}

program.parse(process.argv);