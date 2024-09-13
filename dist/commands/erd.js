"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createERD = void 0;
const duckdb_async_1 = require("duckdb-async");
const metadata_1 = require("../lib/metadata");
const createERD = async (databasePath) => {
    const db = await duckdb_async_1.Database.create(databasePath);
    const conn = await db.connect();
    const metadata = await (0, metadata_1.getMetadata)(conn);
    await db.close();
    const mermaidCode = (0, metadata_1.generateMermaidCodeForAllDBs)(metadata);
    return mermaidCode;
};
exports.createERD = createERD;
