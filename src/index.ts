#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';
import { createERD } from './commands/erd';

const program = new Command();

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
    
    run(dbPath, options);
  });

const run = async (dbPath: string, options: any) => {
  const mermaidDiagram = await createERD(dbPath);
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

    exec(command, (error, stdout, stderr) => {
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
