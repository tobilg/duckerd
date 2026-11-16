/**
 * Converts Microsoft's AdventureWorks OLTP install script (T-SQL) into DuckDB DDL.
 *
 *   curl -LO https://raw.githubusercontent.com/microsoft/sql-server-samples/master/samples/databases/adventure-works/oltp-install-script/instawdb.sql
 *   npx tsx examples/adventureworks/convert.ts instawdb.sql > examples/adventureworks/schema.sql
 *
 * Only the schema is converted: tables, columns, primary keys, and foreign keys.
 * DuckDB does not support foreign keys across schemas or added with ALTER TABLE,
 * so all tables go into one schema (their names are unique), keys are declared
 * inline, and tables are ordered so each one follows the tables it references.
 * The original schema is kept as a table comment.
 */
import { readFileSync } from 'node:fs';

interface Column { name: string; type: string; notNull: boolean }
interface ForeignKey { columns: string[]; table: string; references: string[] }
interface Table { schema: string; name: string; columns: Column[]; primaryKey?: string[]; foreignKeys: ForeignKey[] }

const userTypes: Record<string, string> = {
  AccountNumber: 'VARCHAR', Flag: 'BOOLEAN', NameStyle: 'BOOLEAN', Name: 'VARCHAR', OrderNumber: 'VARCHAR', Phone: 'VARCHAR',
};

const mapType = (type: string, args?: string): string => {
  switch (type.toLowerCase()) {
    case 'int': return 'INTEGER';
    case 'smallint': return 'SMALLINT';
    case 'tinyint': return 'UTINYINT';
    case 'bit': return 'BOOLEAN';
    case 'money': return 'DECIMAL(19,4)';
    case 'smallmoney': return 'DECIMAL(10,4)';
    case 'decimal': case 'numeric': return `DECIMAL(${args})`;
    case 'float': return 'DOUBLE';
    case 'real': return 'FLOAT';
    case 'datetime': case 'datetime2': case 'smalldatetime': return 'TIMESTAMP';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'nvarchar': case 'varchar': case 'nchar': case 'char': case 'xml': case 'hierarchyid': case 'sysname': return 'VARCHAR';
    case 'uniqueidentifier': return 'UUID';
    case 'varbinary': case 'image': case 'geography': return 'BLOB';
    default: {
      if (userTypes[type]) return userTypes[type];
      throw new Error(`Unmapped type: ${type}`);
    }
  }
};

// Computed columns have no declared type; these follow their T-SQL expressions.
const computedTypes: Record<string, string> = {
  'Customer.AccountNumber': 'VARCHAR',
  'Document.DocumentLevel': 'SMALLINT',
  'Employee.OrganizationLevel': 'SMALLINT',
  'PurchaseOrderDetail.LineTotal': 'DECIMAL(19,4)',
  'PurchaseOrderDetail.StockedQty': 'DECIMAL(9,2)',
  'PurchaseOrderHeader.TotalDue': 'DECIMAL(19,4)',
  'SalesOrderDetail.LineTotal': 'DECIMAL(38,6)',
  'SalesOrderHeader.SalesOrderNumber': 'VARCHAR',
  'SalesOrderHeader.TotalDue': 'DECIMAL(19,4)',
  'WorkOrder.StockedQty': 'INTEGER',
};

/** Splits on commas that are not inside parentheses. */
const splitTopLevel = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; } else current += char;
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
};

const names = (list: string): string[] => list.split(',').map((name) => name.trim().replace(/^\[|\]$/g, ''));

// Comments appear inside table and key definitions, so they are removed first.
// The string literals that matter here contain no comment markers.
const script = readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const tables = new Map<string, Table>();

for (const [, schema, name, body] of script.matchAll(/CREATE TABLE \[(\w+)\]\.\[(\w+)\]\s*\(([\s\S]*?)\)\s*ON \[PRIMARY\]/g)) {
  const columns = splitTopLevel(body).filter((definition) => definition.startsWith('[')).map((definition): Column => {
    const match = definition.match(/^\[([^\]]+)\]\s+(.*)$/s);
    if (!match) throw new Error(`Unparsed column in ${name}: ${definition}`);
    // AWBuildVersion has "Database Version"; Mermaid attribute names cannot contain spaces.
    const column = match[1].replace(/\s+/g, '');
    const rest = match[2];
    if (/^AS\b/i.test(rest)) {
      const type = computedTypes[`${name}.${column}`];
      if (!type) throw new Error(`Unmapped computed column ${name}.${column}`);
      return { name: column, type, notNull: false };
    }
    const [, type, args] = rest.match(/^\[?(\w+)\]?(?:\s*\(([^)]*)\))?/)!;
    return { name: column, type: mapType(type, args), notNull: /\bNOT NULL\b/i.test(definition) };
  });
  if (tables.has(name)) throw new Error(`Duplicate table name across schemas: ${name}`);
  tables.set(name, { schema, name, columns, foreignKeys: [] });
}

// Keys are added by ALTER TABLE statements, each ending at the first semicolon.
for (const [statement, tableName] of script.matchAll(/ALTER TABLE \[\w+\]\.\[(\w+)\][^;]*;/g)) {
  const table = tables.get(tableName);
  if (!table) continue;
  const primaryKey = statement.match(/CONSTRAINT \[\w+\] PRIMARY KEY (?:NON)?CLUSTERED\s*\(([^)]*)\)/);
  if (primaryKey) table.primaryKey = names(primaryKey[1]);
  for (const [, columns, , referenced, references] of statement.matchAll(
    /CONSTRAINT \[\w+\] FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES \[(\w+)\]\.\[(\w+)\]\s*\(([^)]*)\)/g)) {
    table.foreignKeys.push({ columns: names(columns), table: referenced, references: names(references) });
  }
}

// Order tables so every referenced table is created first; self-references are fine.
const ordered: Table[] = [];
const visiting = new Set<string>();
const visit = (table: Table) => {
  if (ordered.includes(table)) return;
  if (visiting.has(table.name)) throw new Error(`Foreign key cycle through ${table.name}`);
  visiting.add(table.name);
  for (const key of table.foreignKeys) if (key.table !== table.name) visit(tables.get(key.table)!);
  visiting.delete(table.name);
  ordered.push(table);
};
[...tables.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(visit);

for (const table of ordered) {
  for (const key of table.foreignKeys) {
    const target = tables.get(key.table)!;
    if (target.primaryKey?.join() !== key.references.join()) {
      throw new Error(`${table.name} references ${key.table}(${key.references}) which is not its primary key`);
    }
  }
}

const output = [
  '-- AdventureWorks OLTP schema for DuckDB, converted from Microsoft\'s instawdb.sql',
  '-- (https://github.com/microsoft/sql-server-samples, MIT License; see LICENSE).',
  '-- Generated by convert.ts: tables, columns, primary keys, and foreign keys only.',
  '',
];
// DuckDB reserved words used as AdventureWorks column names.
const reserved = new Set(['group', 'primary']);
const quote = (name: string): string => reserved.has(name.toLowerCase()) ? `"${name}"` : name;
const list = (columns: string[]): string => columns.map(quote).join(', ');

for (const table of ordered) {
  const lines = table.columns.map((column) => `  ${quote(column.name)} ${column.type}${column.notNull ? ' NOT NULL' : ''}`);
  if (table.primaryKey) lines.push(`  PRIMARY KEY (${list(table.primaryKey)})`);
  for (const key of table.foreignKeys) {
    lines.push(`  FOREIGN KEY (${list(key.columns)}) REFERENCES ${key.table} (${list(key.references)})`);
  }
  output.push(`CREATE TABLE ${table.name} (\n${lines.join(',\n')}\n);`);
  output.push(`COMMENT ON TABLE ${table.name} IS 'AdventureWorks schema: ${table.schema}';`, '');
}
process.stdout.write(output.join('\n'));
const keys = ordered.reduce((sum, table) => sum + table.foreignKeys.length, 0);
console.error(`${ordered.length} tables, ${keys} foreign keys`);
