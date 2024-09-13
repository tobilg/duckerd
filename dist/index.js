#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const erd_1 = require("./commands/erd");
const program = new commander_1.Command();
program
    .version('0.1.0')
    .description('A CLI tool for generating ERD diagrams from DuckDB databases')
    .option('-d, --database <path>', 'Path to the database file')
    .option('-t, --theme [theme]', 'Theme of the chart (choices: "default", "forest", "dark", "neutral", default: "default")')
    .option('-o, --output <path>', 'Path to the output file')
    .option('-w, --width [width]', 'Width of the page (default: 1024)')
    .option('-H, --height [height]', 'Height of the page (default: 768)')
    .option('-f, --outputFormat [format]', 'Output format for the generated image. (choices: "svg", "png", "pdf")')
    .action((options) => {
    const dbPath = options.database ? path.resolve(options.database) : ':memory:';
    console.log('Generating ERD diagram...');
    // Check if the database file exists
    if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
        console.error(`Error: Database file not found at ${dbPath}`);
        process.exit(1);
    }
    runErd(dbPath, options);
});
const runErd = async (dbPath, options) => {
    const mermaidDiagram = await (0, erd_1.createERD)(dbPath);
    const mermaidFile = path.resolve('schema_erd.mmd');
    if (mermaidDiagram) {
        fs.writeFileSync(mermaidFile, mermaidDiagram);
        // Extract the database name from the dbPath
        const dbName = dbPath === ':memory:' ? 'memory_db' : path.basename(dbPath, path.extname(dbPath));
        const outputFile = options.output || `${dbName}_erd.${options.outputFormat || 'png'}`;
        const width = options.width || 1024;
        const height = options.height || 768;
        const theme = options.theme || 'default';
        const command = `npx mmdc -i ${mermaidFile} -o ${outputFile} -t ${theme} -w ${width} -H ${height}`;
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error generating ERD: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`ERD generation stderr: ${stderr}`);
                return;
            }
            console.log(`ERD diagram generated: ${outputFile}`);
            fs.unlinkSync(mermaidFile);
        });
    }
};
program.parse(process.argv);
