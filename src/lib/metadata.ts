import { DuckDBConnection } from '@duckdb/node-api';
import { DEFAULT_INFER_REGEX, INFERRED_RELATIONSHIPS_COMMENT, inferRelationships } from './inference';

export interface Metadata {
  databases?: Database[];
}

export interface Database {
  name: string;
  schemas?: Schema[];
}

interface RawDatabase {
  databaseName: string;
}

interface RawSchema {
  databaseName: string;
  schemaName: string;
}

export interface Schema {
  name: string;
  tables?: Table[];
  sequences?: Sequence[];
}

export interface Table {
  databaseName?: string;
  schemaName?: string;
  name: string;
  hasPrimaryKey: boolean;
  estimatedRowCount: number;
  columnCount: number;
  indexCount: number;
  checkConstraintCount: number;
  sql: string;
  columns?: Column[];
  indexes?: Index[];
  constraints?: Constraint[];
}

export interface Column {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  name: string;
  dataType: string;
  precision: number;
  scale: number;
  isNullable: boolean;
}

export interface Sequence {
  databaseName?: string;
  schemaName?: string;
  name: string;
  isTemporary: boolean;
  startValue: number;
  lastValue: number;
  minValue: number;
  maxValue: number;
  incrementBy: number;
  sql: string;
}

/** Constraint kinds reported by duckdb_constraints(). */
export type ConstraintType = 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'NOT NULL';

interface ConstraintFields {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  columnName: string;
  sql: string;
}

/** A foreign key always names the table it references; other constraints never do. */
export type Constraint = ConstraintFields & (
  | {
    constraintType: 'FOREIGN KEY';
    /** The table a foreign key references, unquoted and without a schema. */
    referencedTable: string;
  }
  | { constraintType: Exclude<ConstraintType, 'FOREIGN KEY'>; referencedTable?: undefined }
);

export interface Index {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  name: string;
  isUnique: boolean;
  sql: string;
}

// Database metadata query
const databaseMetadataQuery = `SELECT database_name as databaseName FROM duckdb_databases() WHERE database_name NOT IN ('system', 'temp') ORDER BY database_name`;
// Schema metadata query
const schemaMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName FROM duckdb_schemas() WHERE database_name NOT IN ('system', 'temp') and schema_name NOT IN ('information_schema', 'pg_catalog') ORDER BY database_name, schema_name`;
// Table metadata query
const tablesMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, table_name as name, has_primary_key as hasPrimaryKey, estimated_size as estimatedRowCount, column_count as columnCount, index_count as indexCount, check_constraint_count as checkConstraintCount, sql FROM duckdb_tables() WHERE internal = false ORDER BY database_name, schema_name, table_name`;
// Column metadata query
const columnsMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, table_name as tableName, column_name as name, data_type as dataType, numeric_precision as precision, numeric_scale as scale, is_nullable as isNullable FROM duckdb_columns() WHERE internal = false ORDER BY database_name, schema_name, table_name, column_index`;
// Index metadata query
const indexesMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, table_name as tableName, index_name as name, is_unique as isUnique, sql FROM duckdb_indexes() ORDER BY database_name, schema_name, table_name, index_name`;
// Constraints metadata query
const contraintsMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, table_name as tableName, unnest(constraint_column_names) as columnName, constraint_type as constraintType, referenced_table as referencedTable, constraint_text as sql FROM duckdb_constraints() ORDER BY database_name, schema_name, table_name`;
// Constraints metadata query
const sequencesMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, sequence_name as name, temporary as isTemporary, start_value as startValue, last_value as lastValue, min_value as minValue, max_value as maxValue, increment_by as incrementBy, sql FROM duckdb_sequences() ORDER BY database_name, schema_name, sequence_name`;

const queryAll = async <T>(conn: DuckDBConnection, sql: string): Promise<T[]> => {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as unknown as T[];
}

export const getMetadata = async (conn: DuckDBConnection): Promise<Metadata> => {
  const databaseRaw = await queryAll<RawDatabase>(conn, databaseMetadataQuery);
  const schemas = await queryAll<RawSchema>(conn, schemaMetadataQuery);
  const tables = await queryAll<Table>(conn, tablesMetadataQuery);
  const columns = await queryAll<Column>(conn, columnsMetadataQuery);
  const indexes = await queryAll<Index>(conn, indexesMetadataQuery);
  const constraints = await queryAll<Constraint>(conn, contraintsMetadataQuery);
  const sequences = await queryAll<Sequence>(conn, sequencesMetadataQuery);

  const databases = databaseRaw.map(database => ({
    name: database.databaseName,
    schemas: [...new Set(schemas.filter(schema => database.databaseName === schema.databaseName).map(schema => ({
      name: schema.schemaName,
      tables: [...new Set(tables.filter(table => schema.databaseName === table.databaseName && schema.schemaName === table.schemaName).map(table => ({
        databaseName: database.databaseName,
        schemaName: schema.schemaName,
        name: table.name,
        hasPrimaryKey: table.hasPrimaryKey,
        estimatedRowCount: table.estimatedRowCount,
        columnCount: table.columnCount,
        indexCount: table.indexCount,
        checkConstraintCount: table.checkConstraintCount,
        sql: table.sql,
        columns: [...new Set(columns.filter(column => column.databaseName === table.databaseName && column.schemaName === table.schemaName && column.tableName === table.name).map(column => ({
          name: column.name,
          dataType: column.dataType,
          precision: column.precision,
          scale: column.scale,
          isNullable: column.isNullable,
        }) as Column))],
        indexes: [...new Set(indexes.filter(index => index.databaseName === table.databaseName && index.schemaName === table.schemaName && index.tableName === table.name).map(index => ({
          name: index.name,
          isUnique: index.isUnique,
          sql: index.sql,
        }) as Index))],
        constraints: [...new Set(constraints.filter((constraint) => constraint.databaseName === table.databaseName && constraint.schemaName === table.schemaName && constraint.tableName === table.name).map(constraint => ({
          columnName: constraint.columnName,
          constraintType: constraint.constraintType,
          referencedTable: constraint.referencedTable ?? undefined,
          sql: constraint.sql,
        }) as Constraint))],
      })))],
      sequences: [...new Set(sequences.filter(sequence => sequence.databaseName === schema.databaseName && sequence.schemaName === schema.schemaName).map(sequence => ({
        name: sequence.name,
        isTemporary: sequence.isTemporary,
        startValue: sequence.startValue,
        lastValue: sequence.lastValue,
        minValue: sequence.minValue,
        maxValue: sequence.maxValue,
        incrementBy: sequence.incrementBy,
        sql: sequence.sql,
      }) as Sequence))],
    }) as Schema))],
  }));

  const metadata: Metadata = {
    databases,
  };

  return metadata;
}

/**
 * How much of each table to draw: every column, only key columns (PK, FK, and
 * columns behind inferred relationships), or the table name alone.
 */
export const detailLevels = ['full', 'keys', 'names'] as const;
export type DetailLevel = typeof detailLevels[number];

/**
 * Folds an identifier the way DuckDB compares them: ASCII letters only, so
 * "Ä" and "ä" stay distinct while "PersonID" and "personid" match.
 */
const foldIdentifier = (name: string): string => name.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

export const generateMermaidCodeForAllDBs = (
  metadata: Metadata, expandStructs: boolean = false, infer: boolean = false,
  inferRegex: RegExp = DEFAULT_INFER_REGEX, detail: DetailLevel = 'full',
): string | undefined => {
  let mermaidCode = `erDiagram
  
  `;

  const tables = (metadata.databases ?? []).flatMap(db => (db.schemas ?? []).flatMap(schema =>
    (schema.tables ?? []).map(table => ({
      ...table, databaseName: table.databaseName ?? db.name, schemaName: table.schemaName ?? schema.name,
    })),
  ));
  if (tables.length === 0) return undefined;

  const hasForeignKeys = tables.some(table => table.constraints?.some(constraint => constraint.constraintType === 'FOREIGN KEY'));
  const inferred = infer && !hasForeignKeys ? inferRelationships(tables, inferRegex) : [];
  const names = new Map<string, number>();
  for (const table of tables) {
    const name = `${table.databaseName}.${table.name}`;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  // Tables that share a name across schemas would merge into one entity; qualify them with the schema.
  const qualifiedName = (databaseName: string, schemaName: string, name: string): string =>
    (names.get(`${databaseName}.${name}`) ?? 0) > 1 ? `${databaseName}.${schemaName}.${name}` : `${databaseName}.${name}`;
  const entityName = (table: Table): string => qualifiedName(table.databaseName!, table.schemaName!, table.name);
  if (inferred.length > 0) mermaidCode += `${INFERRED_RELATIONSHIPS_COMMENT}\n  `;

  // Columns behind inferred relationships, per table; only `keys` detail needs them.
  const inferredColumns = new Map<Table, Set<string>>();
  if (detail === 'keys') {
    for (const { left, right, columns } of inferred) {
      for (const table of [left, right]) {
        const set = inferredColumns.get(table) ?? new Set<string>();
        for (const column of columns) set.add(column.toLowerCase());
        inferredColumns.set(table, set);
      }
    }
  }

  // Add tables, columns and declared constraints without inventing FK markers.
  mermaidCode += tables.map((table) => {
    // DuckDB identifiers are case-insensitive, so a constraint may spell its
    // columns differently from the table definition: PRIMARY KEY (personid).
    const markers = new Map<string, string[]>();
    for (const constraint of table.constraints ?? []) {
      const marker = constraint.constraintType === 'PRIMARY KEY' ? 'PK' : constraint.constraintType === 'FOREIGN KEY' ? 'FK' : '';
      if (!marker) continue;
      const column = foldIdentifier(constraint.columnName);
      markers.set(column, [...markers.get(column) ?? [], marker]);
    }
    const columns = (table.columns ?? []).flatMap((column) => {
      const constraintMarkers = markers.get(foldIdentifier(column.name)) ?? [];
      if (detail === 'names') return [];
      if (detail === 'keys' && constraintMarkers.length === 0 && !inferredColumns.get(table)?.has(column.name.toLowerCase())) return [];
      const structFields = expandStructs ? expandStructFields(column.name, column.dataType) : [];
      if (structFields.length > 0) {
        return structFields.map((field) => `      ${sanitizeDataType(field.type.toUpperCase())} ${field.name}`);
      }
      return [`      ${sanitizeDataType(column.dataType.toUpperCase())} ${column.name} ${constraintMarkers}${addCommentIfNecessary(column.dataType)}`];
    }).join('\n');
    // Composite keys have one row per column; draw one edge per constraint. DuckDB
    // keeps foreign keys within a schema, so the referenced table shares this schema.
    const referencedTables = new Map((table.constraints ?? []).flatMap((constraint) => {
      if (constraint.constraintType !== 'FOREIGN KEY') return [];
      // Hand-built metadata could omit the target, which would draw a table named "undefined".
      if (!constraint.referencedTable) {
        throw new Error(`Foreign key on ${table.databaseName}.${table.name} has no referenced table: ${constraint.sql}`);
      }
      return [[constraint.sql, constraint.referencedTable] as const];
    }));
    const foreignKeys = [...referencedTables.values()]
      .map((referenced) => `    "${qualifiedName(table.databaseName, table.schemaName, referenced)}" ||--o{ "${entityName(table)}" : ""`).join('\n');
    // Mermaid allows an entity without an attribute block; it renders as a name-only box.
    const entity = columns ? `"${entityName(table)}" {\n${columns}\n    }` : `"${entityName(table)}"`;
    return `${entity}\n${foreignKeys}`;
  }).join('\n    ');

  if (inferred.length > 0) {
    mermaidCode += '\n' + inferred.map(({ left, right, columns }) =>
      `    "${entityName(left)}" }o..o{ "${entityName(right)}" : "inferred: ${columns.join(', ')} (unknown)"`,
    ).join('\n');
  }
  return mermaidCode;
}

export const parseStructFields = (dataType: string): { name: string; type: string }[] => {
  if (!dataType.toUpperCase().startsWith("STRUCT(")) {
    return [];
  }
  const inner = dataType.slice(dataType.indexOf("(") + 1, dataType.lastIndexOf(")"));
  const fields: { name: string; type: string }[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "<") depth++;
    else if (ch === ")" || ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      const parts = current.trim().split(/\s+/);
      if (parts.length >= 2) {
        fields.push({ name: parts[0].replace(/['"]/g, ""), type: parts.slice(1).join(" ") });
      }
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    const parts = current.trim().split(/\s+/);
    if (parts.length >= 2) {
      fields.push({ name: parts[0].replace(/['"]/g, ""), type: parts.slice(1).join(" ") });
    }
  }
  return fields;
}

export const expandStructFields = (prefix: string, dataType: string): { name: string; type: string }[] => {
  const fields = parseStructFields(dataType);
  if (fields.length === 0) return [];
  return fields.flatMap((field) => {
    const nestedFields = parseStructFields(field.type);
    if (nestedFields.length > 0) {
      return expandStructFields(`${prefix}__${field.name}`, field.type);
    }
    return [{ name: `${prefix}__${field.name}`, type: field.type }];
  });
}

const COLLAPSIBLE_TYPES = ["STRUCT", "MAP", "ENUM"];

export const sanitizeDataType = (dataType: string): string => {
  const upper = dataType.toUpperCase();
  for (const t of COLLAPSIBLE_TYPES) {
    if (upper.startsWith(`${t}(`)) {
      return t;
    }
  }

  if (dataType.includes(",")) {
    return dataType.replace(/,/g, "_");
  }

  return dataType;
}

export const addCommentIfNecessary = (dataType: string): string => {
  if (dataType.startsWith("ENUM(")) {
    return ` "${dataType.replace("ENUM(", "").replace(")", "").split(",").map((value) => value.trim().replace(/'/g, "").replace(/"/g, "")).join(", ")}"`;
  }

  return "";
}
