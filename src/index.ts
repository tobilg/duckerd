#!/usr/bin/env node

import { Command, InvalidArgumentError, Option } from 'commander';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createERD } from './commands/erd';
import { OutputFormat, outputFormats, renderERD } from './lib/render';
import { loadTheme, Theme, themeNames } from './lib/themes';
import { version } from '../package.json';

interface Options {
  database?: string;
  theme: Theme;
  themeFile?: string;
  themeJson?: string;
  output?: string;
  mmdOutput?: string;
  expandStructs?: boolean;
  width: number;
  height: number;
  outputFormat?: OutputFormat;
}

const positiveInteger = (value: string): number => {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0) {
    throw new InvalidArgumentError('Must be a positive integer.');
  }
  return number;
};

const program = new Command();

program
  .version(version)
  .description('Generate ERD diagrams from DuckDB databases using Pele')
  .option('-d, --database <path>', 'Path to the database file')
  .addOption(new Option('-t, --theme <theme>', 'Color palette of the chart').choices([...themeNames]).default('default'))
  .option('--theme-file <path>', 'JSON theme file overriding the selected preset')
  .option('--theme-json <json>', 'Inline JSON theme overrides (takes precedence over --theme-file)')
  .option('-o, --output <path>', 'Path to the output file (its extension determines the format unless -f is supplied)')
  .option('-m, --mmd-output <path>', 'Save the ER diagram source (.mmd) consumed by Pele')
  .option('-e, --expand-structs', 'Expand STRUCT type columns into individual sub-field rows')
  .option('-w, --width <width>', 'Output canvas width in pixels', positiveInteger, 1024)
  .option('-H, --height <height>', 'Output canvas height in pixels', positiveInteger, 768)
  .addOption(new Option('-f, --outputFormat <format>', 'Output format (default: output extension or png)').choices([...outputFormats]))
  .action(async (options: Options) => {
    const dbPath = !options.database || options.database === ':memory:' ? ':memory:' : path.resolve(options.database);
    if (dbPath !== ':memory:' && !existsSync(dbPath)) {
      throw new Error(`Database file not found at ${dbPath}`);
    }

    const extension = options.output ? path.extname(options.output).slice(1).toLowerCase() : '';
    const format = options.outputFormat ?? (extension || 'png');
    if (!outputFormats.includes(format as OutputFormat)) {
      throw new Error(`Unsupported output format "${format}". Choose svg, png, or pdf.`);
    }
    const dbName = dbPath === ':memory:' ? 'memory_db' : path.basename(dbPath, path.extname(dbPath));
    const outputFile = path.resolve(options.output ?? `${dbName}_erd.${format}`);
    if (options.mmdOutput && path.resolve(options.mmdOutput) === outputFile) {
      throw new Error('The diagram output and source output must use different paths.');
    }

    const theme = await loadTheme(options);
    console.log('Generating ERD diagram...');
    const source = await createERD(dbPath, options.expandStructs ?? false);
    if (!source) {
      console.log('No tables found in the database.');
      return;
    }

    const image = await renderERD(source, { ...options, theme, format: format as OutputFormat });
    if (options.mmdOutput) await writeFile(path.resolve(options.mmdOutput), source);
    await writeFile(outputFile, image);
    console.log(`ERD diagram generated: ${outputFile}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error generating ERD: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
