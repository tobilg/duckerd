# DuckERD CLI

A CLI tool for generating ERD diagrams from DuckDB databases using [Pele](https://pele.run/api).

## Prerequisites

- Node.js (v22.12.0 or later)

## Installation

To install the CLI tool, run:

```
npm install -g duckerd
```

All rendering dependencies are installed with DuckERD. Generating diagrams runs locally without a browser, runtime package downloads, or a separate renderer installation.

## Usage

```
duckerd [options]
```

Generate an ERD diagram of the database schemas.

#### Options:

- `-d, --database <path>`: Path to the database file
- `-t, --theme <theme>`: Color palette (choices: `default`, `forest`, `dark`, `neutral`, default: `default`)
- `--theme-file <path>`: JSON theme file overriding the selected preset
- `--theme-json <json>`: Inline JSON theme overrides, applied after the theme file
- `-o, --output <path>`: Path to the output file; its extension selects the format unless `-f` is supplied
- `-m, --mmd-output <path>`: Save the ER diagram source consumed by Pele. Pele accepts Mermaid syntax, so source files keep the `.mmd` extension. No source file is written by default.
- `-w, --width <width>`: Output canvas width in pixels (default: `1024`)
- `-H, --height <height>`: Output canvas height in pixels (default: `768`)
- `-f, --outputFormat <format>`: Output format (choices: `svg`, `png`, `pdf`; default: output file extension, or `png`)
- `-e, --expand-structs`: Expand `STRUCT` columns into individual sub-field rows (e.g. `full_name STRUCT(given VARCHAR, family VARCHAR)` becomes `full_name__given` and `full_name__family`)

#### Example:

```bash
duckerd -d ./mydb.duckdb -o ./erd.png -f png -t neutral -w 1600
```

Pele produces the SVG directly. PNG exports use `@resvg/resvg-js`; PDF exports use vector paths with PDFKit and `svg-to-pdfkit`. These are normal package dependencies. Diagrams fit within the requested canvas while preserving their aspect ratio. PDF pages use the same dimensions in points.

The theme names are retained as DuckERD palettes applied to Pele. Layout and colors differ from the previous renderer.

For SVG output with a saved source file:

```bash
duckerd -d ./mydb.duckdb -o ./erd.svg -m ./erd.mmd
```

## Custom themes

Override any of the eight palette colors, `fontFamily`, `fontSize`, or `borderRadius` using a JSON file or inline JSON. All fields are optional. Settings merge in this order: **selected preset → theme file → inline JSON**, with colors merged individually.

Save a theme as `brand.json`:

```json
{
  "colors": {
    "background": "#101820",
    "foreground": "#eeeeee",
    "surface": "#203040",
    "border": "#547080"
  },
  "fontFamily": "Arial, sans-serif",
  "fontSize": 16,
  "borderRadius": 8
}
```

```bash
duckerd -d ./mydb.duckdb -o ./erd.svg --theme dark --theme-file ./brand.json
duckerd -d ./mydb.duckdb -o ./erd.png --theme dark --theme-json '{"colors":{"accent":"#ffcc00"}}'
```

The color keys are `background`, `foreground`, `muted`, `line`, `surface`, `surfaceAlt`, `border`, and `accent`. Use `#RGB` or `#RRGGBB` colors. Font size must be positive; corner radius must be non-negative, with `0` giving square table corners. Font names can include an unquoted fallback list, such as `Arial, sans-serif`.

Custom themes apply to SVG, PNG, and PDF. PNG/PDF use installed fonts; SVG font appearance also depends on its viewer. Unknown properties and invalid values produce an error before writing output. See the [theme reference](docs/themes.md) for defaults, validation, and combined overrides, and the [complete example](docs/themes/brand.json).

## Usage example

### Download the example database
For this example we use the [AWS IAM database](https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb) from the [AWS IAM Data](https://github.com/tobilg/aws-iam-data) project.

```bash
curl -LO https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb
```

### Generate the ERD
Then, we can generate the ERD as PNG with the `neutral` theme and otherwise default settings:

```bash
duckerd -d ./iam.duckdb -f png -t neutral
```

### Result

The command writes `iam_erd.png` in the current directory.

## Development

```bash
npm install
npm run build
npm test
```

Tests cover metadata helpers, theme validation and precedence, custom colors/fonts/corners in all three formats, and CLI generation with npm unavailable.

## CI and releases

GitHub Actions uses a shared build-and-test job for pushes to `main` and `v<version>` tags on Node.js 24. For release tags, a dependent publish job validates the release, then downloads the tested package and publishes it to npm through trusted publishing. Release tags must match `package.json` and point to a commit in `main`'s history. Stable releases use npm's `latest` tag; prereleases use `next`.

Before the first automated release, configure the npm trusted publisher for `tobilg/duckerd` and workflow filename `ci.yml`, with direct `npm publish` allowed. See the [publishing guide](docs/publishing.md) for the exact settings and release commands.
