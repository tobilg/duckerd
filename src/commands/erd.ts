import { Database } from 'duckdb-async';
import { generateMermaidCodeForAllDBs, getMetadata } from '../lib/metadata';

export const createERD = async (databasePath: string): Promise<string | undefined> => {
  const db = await Database.create(databasePath);
  const conn = await db.connect();
  const metadata = await getMetadata(conn);
  await db.close();

  const mermaidCode = generateMermaidCodeForAllDBs(metadata);
  
  return mermaidCode;
}