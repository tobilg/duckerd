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
- `-o, --output [output]`: Path to the output file
- `-w, --width [width]`: Width of the page (default: `1024`)
- `-h, --height [height]`: Height of the page (default: `768`)
- `-f, --outputFormat [format]`: Output format for the generated image (choices: `svg`, `png`, `pdf`, default: `png`)

#### Example:

```bash
duckerd -d ./mydb.duckdb -o ./erd.png -f png -t neutral -w 1600
```
