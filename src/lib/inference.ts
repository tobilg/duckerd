import type { Table } from './metadata';

export const DEFAULT_INFER_REGEX = /_id$/i;
export const INFERRED_RELATIONSHIPS_COMMENT = '%% duckerd:inferred-relationships';

export interface InferredRelationship {
  left: Table;
  right: Table;
  columns: string[];
}

const tableKey = (table: Table): string => JSON.stringify([table.databaseName, table.schemaName, table.name]);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export const inferRelationships = (
  tables: Table[], pattern: RegExp = DEFAULT_INFER_REGEX,
): InferredRelationship[] => {
  const candidates = new Map<string, { columnName: string; tables: Map<string, Table> }>();
  const matcher = new RegExp(pattern);
  for (const table of [...tables].sort((a, b) => compare(tableKey(a), tableKey(b)))) {
    for (const column of table.columns ?? []) {
      matcher.lastIndex = 0;
      if (!matcher.test(column.name)) continue;
      // Compare the full catalog type, not the shortened ER display type.
      const key = JSON.stringify([table.databaseName, table.schemaName, column.name.toLowerCase(), column.dataType]);
      let group = candidates.get(key);
      if (!group) {
        group = { columnName: column.name, tables: new Map() };
        candidates.set(key, group);
      }
      group.tables.set(tableKey(table), table);
    }
  }

  const relationships = new Map<string, InferredRelationship>();
  for (const group of candidates.values()) {
    const matches = [...group.tables.entries()];
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const [leftKey, left] = matches[i];
        const [rightKey, right] = matches[j];
        const key = JSON.stringify([leftKey, rightKey]);
        let relationship = relationships.get(key);
        if (!relationship) {
          relationship = { left, right, columns: [] };
          relationships.set(key, relationship);
        }
        relationship.columns.push(group.columnName);
      }
    }
  }

  return [...relationships.entries()].sort(([a], [b]) => compare(a, b)).map(([, relationship]) => ({
    ...relationship, columns: [...new Set(relationship.columns)].sort(compare),
  }));
};
