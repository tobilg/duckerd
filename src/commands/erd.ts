import { DuckDBInstance } from '@duckdb/node-api';
import { generateMermaidCodeForAllDBs, getMetadata } from '../lib/metadata';

export const createERD = async (databasePath: string, expandStructs: boolean = false): Promise<string | undefined> => {
  const instance = await DuckDBInstance.create(databasePath);
  const conn = await instance.connect();

  try {
    const metadata = await getMetadata(conn);
    return generateMermaidCodeForAllDBs(metadata, expandStructs);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}
