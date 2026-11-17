import type { Table } from './metadata';

export const DEFAULT_INFER_REGEX = /_id$/i;
export const INFERRED_RELATIONSHIPS_COMMENT = '%% duckerd:inferred-relationships';

export interface InferredRelationship {
  left: Table;
  right: Table;
  /** The matched column names, for the edge label. */
  columns: string[];
  /** The exact columns that matched in each table; names may differ in case from `columns`. */
  leftColumns: string[];
  rightColumns: string[];
}

const tableKey = (table: Table): string => JSON.stringify([table.databaseName, table.schemaName, table.name]);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
// Most relationships match on one column, so skip the work for single names.
const sorted = (names: string[]): string[] => names.length < 2 ? names : [...new Set(names)].sort(compare);

export const inferRelationships = (
  tables: Table[], pattern: RegExp = DEFAULT_INFER_REGEX,
): InferredRelationship[] => {
  const candidates = new Map<string, { columnName: string; tables: Map<string, { table: Table; columns: string[] }> }>();
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
      const match = group.tables.get(tableKey(table)) ?? { table, columns: [] };
      match.columns.push(column.name);
      group.tables.set(tableKey(table), match);
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
          // Share the group's column lists; most relationships match on one column.
          relationship = {
            left: left.table, right: right.table, columns: [group.columnName], leftColumns: left.columns, rightColumns: right.columns,
          };
          relationships.set(key, relationship);
        } else {
          relationship.columns.push(group.columnName);
          relationship.leftColumns = [...relationship.leftColumns, ...left.columns];
          relationship.rightColumns = [...relationship.rightColumns, ...right.columns];
        }
      }
    }
  }

  return [...relationships.entries()].sort(([a], [b]) => compare(a, b)).map(([, relationship]) => ({
    ...relationship,
    columns: sorted(relationship.columns),
    leftColumns: sorted(relationship.leftColumns),
    rightColumns: sorted(relationship.rightColumns),
  }));
};
