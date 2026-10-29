import { DuckDBInstance } from '@duckdb/node-api';
import { generateMermaidCodeForAllDBs, getMetadata } from '../lib/metadata';
import { DEFAULT_INFER_REGEX } from '../lib/inference';

export const createERD = async (
  databasePath: string, expandStructs: boolean = false, infer: boolean = false,
  inferRegex: RegExp = DEFAULT_INFER_REGEX,
): Promise<string | undefined> => {
  const instance = await DuckDBInstance.create(databasePath);
  const conn = await instance.connect();

  try {
    const metadata = await getMetadata(conn);
    return generateMermaidCodeForAllDBs(metadata, expandStructs, infer, inferRegex);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}
