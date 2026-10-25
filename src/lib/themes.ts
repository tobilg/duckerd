import { readFile } from 'node:fs/promises';

export const themeNames = ['default', 'forest', 'dark', 'neutral'] as const;
export type Theme = typeof themeNames[number];

export const colorNames = ['background', 'foreground', 'muted', 'line', 'surface', 'surfaceAlt', 'border', 'accent'] as const;
export type ThemeColors = Record<typeof colorNames[number], string>;

export interface ThemeDefinition {
  colors: ThemeColors;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
}

export interface ThemeOverrides {
  colors?: Partial<ThemeColors>;
  fontFamily?: string;
  fontSize?: number;
  borderRadius?: number;
}

const palettes: Record<Theme, ThemeColors> = {
  default: {
    background: '#ffffff', foreground: '#1f1f1f', muted: '#6e6e6e', line: '#1f1f1f',
    surface: '#f3f3f3', surfaceAlt: '#e6e6e6', border: '#8a8a8a', accent: '#5b7bd5',
  },
  forest: {
    background: '#ffffff', foreground: '#203020', muted: '#506850', line: '#365936',
    surface: '#e5f2dd', surfaceAlt: '#cde5bc', border: '#638a52', accent: '#3b783b',
  },
  dark: {
    background: '#1f1f1f', foreground: '#eeeeee', muted: '#bbbbbb', line: '#dddddd',
    surface: '#303030', surfaceAlt: '#404040', border: '#999999', accent: '#8ca8ff',
  },
  neutral: {
    background: '#ffffff', foreground: '#222222', muted: '#555555', line: '#333333',
    surface: '#eeeeee', surfaceAlt: '#dddddd', border: '#666666', accent: '#555555',
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseTheme = (json: string, source: string = '--theme-json'): ThemeOverrides => {
  const invalid = (message: string): never => { throw new Error(`Invalid theme in ${source}: ${message}`); };
  let value: unknown;
  try {
    value = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    return invalid('expected valid JSON.');
  }
  if (!isObject(value)) return invalid('expected a JSON object.');

  const overrides: ThemeOverrides = {};
  for (const [key, setting] of Object.entries(value)) {
    switch (key) {
      case 'colors': {
        if (!isObject(setting)) return invalid('colors must be an object.');
        overrides.colors = {};
        for (const [color, hex] of Object.entries(setting)) {
          if (!colorNames.includes(color as typeof colorNames[number])) {
            return invalid(`unknown property colors.${color}. Allowed colors: ${colorNames.join(', ')}.`);
          }
          if (typeof hex !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) {
            return invalid(`colors.${color} must be a hex color (#RGB or #RRGGBB).`);
          }
          overrides.colors[color as keyof ThemeColors] = (hex.length === 4
            ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex).toLowerCase();
        }
        break;
      }
      case 'fontFamily':
        // Accept unquoted family names/fallback lists, not arbitrary CSS. Pele
        // embeds this in both font declarations and CSS variable fallbacks.
        if (typeof setting !== 'string' || !/^[\p{L}\p{N}_-][\p{L}\p{N}_ -]*(?:, *[\p{L}\p{N}_-][\p{L}\p{N}_ -]*)*$/u.test(setting.trim())) {
          return invalid('fontFamily must be an unquoted font name or comma-separated list of names (letters, numbers, spaces, hyphens, underscores).');
        }
        overrides.fontFamily = setting.split(',').map((name) => name.trim()).join(', ');
        break;
      case 'fontSize':
      case 'borderRadius':
        if (typeof setting !== 'number' || !Number.isFinite(setting) || (key === 'fontSize' ? setting <= 0 : setting < 0)) {
          return invalid(`${key} must be a finite ${key === 'fontSize' ? 'positive' : 'non-negative'} number in pixels.`);
        }
        overrides[key] = setting;
        break;
      default:
        return invalid(`unknown property ${key}. Allowed properties: colors, fontFamily, fontSize, borderRadius.`);
    }
  }
  return overrides;
};

export const resolveTheme = (preset: Theme = 'default', ...overrides: ThemeOverrides[]): ThemeDefinition => {
  let theme: ThemeDefinition = {
    colors: { ...palettes[preset] }, fontFamily: 'sans-serif', fontSize: 16, borderRadius: 4,
  };
  for (const override of overrides) {
    theme = { ...theme, ...override, colors: { ...theme.colors, ...override.colors } };
  }
  return theme;
};

export const loadTheme = async (options: { theme?: Theme; themeFile?: string; themeJson?: string }): Promise<ThemeDefinition> => {
  const overrides: ThemeOverrides[] = [];
  if (options.themeFile !== undefined) {
    let json: string;
    try {
      json = await readFile(options.themeFile, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read theme file "${options.themeFile}": ${error instanceof Error ? error.message : String(error)}`);
    }
    overrides.push(parseTheme(json, `theme file "${options.themeFile}"`));
  }
  if (options.themeJson !== undefined) overrides.push(parseTheme(options.themeJson));
  return resolveTheme(options.theme, ...overrides);
};
