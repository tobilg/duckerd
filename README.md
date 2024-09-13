# DuckERD CLI

A CLI tool for generating ERD diagrams from DuckDB databases.

## Prerequisites

- Node.js (v18.19.0 or later)

## Installation

To install the CLI tool, run:

```
npm install -g duckerd
```

## Usage

```
duckerd [options]
```

Generate an ERD diagram of the database schemas.

#### Options:

- `-d, --database <path>`: Path to the database file
- `-t, --theme [theme]`: Theme of the chart (choices: `default`, `forest`, `dark`, `neutral`, default: `default`)
- `-o, --output <path>`: Path to the output file
- `-w, --width [width]`: Width of the page (default: `1024`)
- `-H, --height [height]`: Height of the page (default: `768`)
- `-f, --outputFormat [format]`: Output format for the generated image (choices: `svg`, `png`, `pdf`, default: `png`)

#### Example:

```bash
duckerd -d ./mydb.duckdb -o ./erd.png -f png -t neutral -w 1600
```

**It's possible that you need to re-run the command after the first execution, because the DuckERD CLI automatically installs the `@mermaid-js/mermaid-cli` package globally when it's missing on your system.**
