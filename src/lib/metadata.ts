import { Connection } from 'duckdb-async';

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

export interface Constraint {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  columnName: string;
  constraintType: string;
  sql: string;
}

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
const contraintsMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, table_name as tableName, unnest(constraint_column_names) as columnName, constraint_type as constraintType, constraint_text as sql FROM duckdb_constraints() ORDER BY database_name, schema_name, table_name`;
// Constraints metadata query
const sequencesMetadataQuery = `SELECT database_name as databaseName, schema_name as schemaName, sequence_name as name, temporary as isTemporary, start_value as startValue, last_value as lastValue, min_value as minValue, max_value as maxValue, increment_by as incrementBy, sql FROM duckdb_sequences() ORDER BY database_name, schema_name, sequence_name`;

export const getMetadata = async (conn: Connection): Promise<Metadata> => {
  const databaseRaw = await conn.all(databaseMetadataQuery) as RawDatabase[];
  const schemas = await conn.all(schemaMetadataQuery) as RawSchema[];
  const tables = await conn.all(tablesMetadataQuery) as Table[];
  const columns = await conn.all(columnsMetadataQuery) as Column[];
  const indexes =   await conn.all(indexesMetadataQuery) as Index[];
  const constraints = await conn.all(contraintsMetadataQuery) as Constraint[];
  const sequences = await conn.all(sequencesMetadataQuery) as Sequence[];

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

export const generateMermaidCodeForAllDBs = (metadata: Metadata): string | undefined => {
  let mermaidCode = `erDiagram
  
  `;

  if (metadata.databases && metadata.databases.length > 0 && metadata.databases[0].schemas && metadata.databases[0].schemas?.length > 0) {
    // Get tables
    const tables = metadata.databases!.map((db) => db.schemas!.map((s) => s.tables!).flat()).flat();

    if (tables && tables.length > 0) {
      // Add tables, columns and constraints
      mermaidCode += tables.map((table) => {
        return `"${table.databaseName}.${table.name}" {
${table.columns!.map((column) => `      ${sanitizeDataType(column.dataType.toUpperCase())} ${column.name} ${table.constraints?.filter((constraint) => constraint.columnName === column.name).map((constraint) => ((constraint.constraintType === "PRIMARY KEY" ? "PK" : "") || (constraint.constraintType === "FOREIGN KEY" ? "FK" : "") || "")).filter(str => str)}`).join("\n")}
    }\n${table.constraints?.filter((constraint) => constraint.constraintType === "FOREIGN KEY").map((constraint) => `    "${table.databaseName}.${constraint.sql.match(/(?:^|)REFERENCES\s([^*]+?)\b\(/i)![1]}" ||--o{ "${table.databaseName}.${table.name}" : has`).join("\n")}`
      }).join("\n    ")

      return mermaidCode;
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}

export const sanitizeDataType = (dataType: string): string => {
  return dataType.startsWith("STRUCT(") ? "STRUCT" : dataType;
}
