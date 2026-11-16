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
- `-w, --width <width>`: Output canvas width in pixels (default: the diagram's natural size; see [Output size](#output-size))
- `-H, --height <height>`: Output canvas height in pixels (default: the diagram's natural size)
- `--detail <level>`: How much of each table to draw (choices: `full`, `keys`, `names`; default: `full`). See [Large databases](#large-databases).
- `-f, --outputFormat <format>`: Output format (choices: `svg`, `png`, `pdf`; default: output file extension, or `png`)
- `-e, --expand-structs`: Expand `STRUCT` columns into individual sub-field rows (e.g. `full_name STRUCT(given VARCHAR, family VARCHAR)` becomes `full_name__given` and `full_name__family`)
- `--infer`: Infer relationships from matching columns when the entire diagram has no declared foreign keys (disabled by default)
- `--infer-regex <pattern>`: Replace the default `_id$` column-name filter with a case-insensitive JavaScript regex pattern; requires `--infer`

#### Example:

```bash
duckerd -d ./mydb.duckdb -o ./erd.png -f png -t neutral -w 1600
```

Pele produces the SVG directly. PNG exports use `@resvg/resvg-js`; PDF exports use vector paths with PDFKit and `svg-to-pdfkit`. These are normal package dependencies.

### Output size

By default, the canvas matches the diagram's natural size, so text stays readable however many tables there are. To choose a size:

- `-w` alone sets the width; the height follows the diagram's aspect ratio. `-H` alone works the same way.
- `-w` and `-H` together fit the diagram inside that canvas, preserving its aspect ratio and centering it.

PDF pages use the same dimensions in points. Two limits protect against unusable files. PNG output is reduced to at most 100 megapixels, since larger images need gigabytes of memory to render. PDF output is reduced to at most 14,400 points per side, the largest page common PDF readers open. When a limit applies, DuckERD prints a warning with the reduced size. SVG output is never reduced.

The theme names are retained as DuckERD palettes applied to Pele. Layout and colors differ from the previous renderer.

For SVG output with a saved source file:

```bash
duckerd -d ./mydb.duckdb -o ./erd.svg -m ./erd.mmd
```

## Large databases

With 50 or more tables, a diagram showing every column becomes very large. Use `--detail` to draw less of each table:

- `full` (default): every column.
- `keys`: only primary-key and foreign-key columns, plus columns behind [inferred relationships](#inferring-relationships). Tables without such columns appear as a name-only box.
- `names`: table names only. All relationships are still drawn, so this gives the most compact overview of the schema.

```bash
duckerd -d ./mydb.duckdb --detail names -o ./overview.svg
duckerd -d ./mydb.duckdb --detail keys -o ./keys.svg
```

The saved `--mmd-output` source reflects the chosen detail level. SVG output suits large diagrams best because viewers can zoom without losing quality.

## Inferring relationships

Use `--infer` for databases without declared foreign keys:

```bash
duckerd -d ./mydb.duckdb --infer -o ./erd.svg
```

By default, columns qualify when their names end in `_id`. Two tables in the same database and schema are linked when their qualifying column names match case-insensitively and their full DuckDB datatypes are identical. For example, `order.order_id INTEGER` and `lineitem.order_id INTEGER` produce a link labeled `inferred: order_id (unknown)`. No primary key is required. `INTEGER` and `BIGINT` do not match, and neither do different `DECIMAL` precisions or different `ENUM` definitions.

Inferred links are dashed, with no cardinality markers in SVG, PNG, or PDF. They indicate possible relationships based on metadata; DuckERD does not inspect row values, determine cardinality, or mark inferred columns as foreign keys. If any declared foreign key exists anywhere in the diagram, inference is skipped entirely and the declared relationships are retained.

Matching is limited to top-level columns; `--expand-structs` does not make nested fields eligible. If three tables share a matching column, all three table pairs are linked. Multiple matching columns between a pair appear on one edge with a sorted list of names; this does not imply a composite key. When inference produces links, table names that collide across schemas are qualified as `database.schema.table`; other names retain `database.table`.

### Custom column-name patterns

`--infer-regex` replaces the default `_id$` filter:

```bash
# Include names ending in either _id or _key
duckerd -d ./mydb.duckdb --infer --infer-regex '(_id|_key)$'

# Only customer_id and order_id
duckerd -d ./mydb.duckdb --infer --infer-regex '^(customer|order)_id$'

# Allow any column name, including id
duckerd -d ./mydb.duckdb --infer --infer-regex '.*'
```

Supply a raw JavaScript regex pattern without `/.../` delimiters or flag syntax. Patterns are always case-insensitive and use normal regex matching: use `^` and `$` to anchor a match. Quote the pattern to protect it from shell expansion; the examples use POSIX shell quoting. The pattern only selects eligible column names. Both columns must still have the same name and datatype; capture groups do not map different names to each other.

Providing `--infer-regex` without `--infer` exits with an error. Invalid regex syntax also exits with status `1`, identifying the option and the parser's reason, for example:

```text
Invalid --infer-regex: Invalid regular expression: /[/i: Unterminated character class
```

Patterns are validated before opening the database or writing files, including when the database is empty or has foreign keys that would suppress inference. Invalid patterns leave existing image and source files unchanged.

### Saved diagram source

With `--mmd-output`, inferred diagrams remain valid Mermaid source. Mermaid requires cardinalities, so the source uses `}o..o{` placeholders, explicit `inferred: … (unknown)` labels, and a `%% duckerd:inferred-relationships` comment. DuckERD recognizes that comment and removes the placeholder endpoint markers from its exports. Other Mermaid renderers display the placeholder many-to-many markers; they do not represent an inferred cardinality.

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

Tests cover metadata helpers, relationship inference and regex validation, theme validation and precedence, exports in all three formats, and CLI generation with npm unavailable.

## CI and releases

GitHub Actions uses a shared build-and-test job for pushes to `main` and `v<version>` tags on Node.js 24. For release tags, a dependent publish job validates the release, then downloads the tested package and publishes it to npm through trusted publishing. Release tags must match `package.json` and point to a commit in `main`'s history. Stable releases use npm's `latest` tag; prereleases use `next`.

Before the first automated release, configure the npm trusted publisher for `tobilg/duckerd` and workflow filename `ci.yml`, with direct `npm publish` allowed. See the [publishing guide](docs/publishing.md) for the exact settings and release commands.
