# Custom themes

DuckERD supports color, font, and table corner overrides for SVG, PNG, and PDF output. Use a JSON file for a reusable theme, inline JSON for a command-specific override, or both.

```bash
duckerd -d ./mydb.duckdb -o ./erd.svg --theme dark --theme-file ./brand.json
duckerd -d ./mydb.duckdb -o ./erd.png --theme dark --theme-json '{"colors":{"surface":"#203040"}}'
```

## Theme definition

All properties are optional. Copy [the complete example](themes/brand.json) to `brand.json`, or start with a partial definition:

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

| Property | Accepted value | Default |
| --- | --- | --- |
| `colors` | Object containing any of the eight colors below | Selected preset |
| `fontFamily` | Unquoted font name or comma-separated list, such as `Arial, sans-serif` | `IBM Plex Sans Condensed, sans-serif` |
| `fontSize` | Finite positive number, in pixels | `14` |
| `borderRadius` | Finite non-negative number, in pixels; `0` gives square table corners | `4` |

Font names accept letters, numbers, spaces, hyphens, and underscores. Font settings are passed to Pele before it lays out the diagram. PDF text is exported as vector paths.

#### Bundled font

DuckERD ships [IBM Plex Sans Condensed](https://github.com/IBM/plex) (SIL Open Font License; see `fonts/OFL.txt` in the package) and uses it by default. With the bundled font listed first in `fontFamily`:

- Tables are sized from the font's real glyph widths, so boxes fit their text closely.
- PNG and PDF output looks the same on every operating system, whatever fonts are installed.
- SVG output embeds a small subset of the font (about 20 KB), so viewers show the same font that the layout was measured with.

With any other font first, PNG and PDF use the fonts installed on the machine generating the file, and SVG uses the fonts available in its viewer. Pele then sizes tables from generic width estimates, so text may fit more loosely or slightly overflow. When a requested font is not installed, PNG and PDF fall back to the bundled font. In PNG and PDF, the generic `sans-serif` also means the bundled font, because the renderer would otherwise pick an arbitrary installed font (on some Windows machines, a serif one).

Font size and corner radius apply to the diagram before any scaling to `--width` or `--height`. Changing the font size affects layout and, without `--width` or `--height`, the output size; otherwise the final displayed size depends on those options. Corner radius applies to table rectangles; relationship label backgrounds retain Pele's own small radius.

### Colors

Colors must be opaque hex strings in `#RGB` or `#RRGGBB` format. Uppercase letters are accepted. Named colors, alpha channels, CSS expressions, and CSS variables are not accepted.

| Color | Used for | Default preset |
| --- | --- | --- |
| `background` | Canvas and relationship label backgrounds | `#ffffff` |
| `foreground` | Table names, column names, and relationship labels | `#1f1f1f` |
| `muted` | Data types and attribute comments | `#6e6e6e` |
| `line` | Relationship lines and cardinality markers | `#1f1f1f` |
| `surface` | Table fill, including headers | `#f3f3f3` |
| `surfaceAlt` | Alternating attribute row fill | `#e6e6e6` |
| `border` | Table borders and dividers | `#8a8a8a` |
| `accent` | Primary and foreign key labels | `#5b7bd5` |

The named presets are `default`, `forest`, `dark`, and `neutral`. DuckERD maps these colors to [Pele's theme variables](https://pele.run/theming) and resolves them into fixed SVG colors. It applies `surfaceAlt` to ER attribute stripes and `accent` to key labels so those settings also affect ordinary table diagrams. Corner styling is emitted as SVG attributes for compatibility with all exporters.

## Precedence

Overrides are applied in this order, independent of the order of flags:

1. The preset selected by `--theme`, or `default` when omitted.
2. The JSON object from `--theme-file`.
3. The JSON object from `--theme-json`.

Colors merge individually. Overriding `colors.surface` retains the other colors inherited from the preset or file. An empty object, including `"colors": {}`, leaves inherited settings unchanged. The preset is selected through `--theme`; it is not a property inside the JSON definition.

```bash
duckerd -d ./mydb.duckdb -o ./erd.pdf \
  --theme dark \
  --theme-file ./brand.json \
  --theme-json '{"colors":{"accent":"#ffcc00"},"borderRadius":0}'
```

This uses the `dark` preset, applies the file, then sets yellow key labels and square table corners. File paths are relative to the current working directory. Quote paths containing spaces. The examples use POSIX shell quoting; JSON arguments must be quoted appropriately for your shell.

## Validation

Both input methods use the same validator. Unreadable files, malformed JSON, unknown properties, and invalid values exit with a nonzero status before rendering or writing output. Errors identify the file or `--theme-json` and the offending property, for example:

```text
Error generating ERD: Invalid theme in --theme-json: colors.background must be a hex color (#RGB or #RRGGBB).
```

Definitions must be JSON objects, not preset names, arrays, or `null`. Each supplied definition is validated even when a later override would replace its value. JSON comments and trailing commas are not supported.

The supported fields are the ones listed above. Arbitrary CSS, font weight overrides, per-table styling, and settings for Pele's other diagram types are not part of this schema. Theme settings affect rendered files; `--mmd-output` continues to save only the ER diagram source.
