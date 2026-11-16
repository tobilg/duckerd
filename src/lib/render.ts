import { Resvg } from '@resvg/resvg-js';
import { render } from 'pele';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { resolveTheme, Theme, ThemeDefinition } from './themes';
import { INFERRED_RELATIONSHIPS_COMMENT } from './inference';

export { themeNames, type Theme } from './themes';

export const outputFormats = ['svg', 'png', 'pdf'] as const;
export type OutputFormat = typeof outputFormats[number];

export interface RenderOptions {
  format: OutputFormat;
  theme: Theme | ThemeDefinition;
  /** Canvas width. With height, the diagram fits inside both; alone, height follows the aspect ratio. */
  width?: number;
  /** Canvas height. With width, the diagram fits inside both; alone, width follows the aspect ratio. */
  height?: number;
  /** Receives a message when the output is scaled below the requested or natural size. */
  onWarning?: (message: string) => void;
}

// resvg allocates 4 bytes per pixel; 100 megapixels already needs about 400 MB.
export const MAX_PNG_PIXELS = 100_000_000;
// Common PDF readers reject pages larger than 200 inches (14,400 points).
export const MAX_PDF_SIDE = 14_400;

interface Layout { width: number; height: number; scale: number }

export const computeLayout = (
  diagram: { width: number; height: number }, format: OutputFormat, width?: number, height?: number,
): Layout & { limited?: string } => {
  let layout: Layout;
  if (width !== undefined && height !== undefined) {
    layout = { width, height, scale: Math.min(width / diagram.width, height / diagram.height) };
  } else if (width !== undefined) {
    const scale = width / diagram.width;
    layout = { width, height: Math.max(1, Math.round(diagram.height * scale)), scale };
  } else if (height !== undefined) {
    const scale = height / diagram.height;
    layout = { width: Math.max(1, Math.round(diagram.width * scale)), height, scale };
  } else {
    layout = { width: Math.ceil(diagram.width), height: Math.ceil(diagram.height), scale: 1 };
  }

  let factor = 1;
  let limited: string | undefined;
  if (format === 'png' && layout.width * layout.height > MAX_PNG_PIXELS) {
    factor = Math.sqrt(MAX_PNG_PIXELS / (layout.width * layout.height));
    limited = `${MAX_PNG_PIXELS / 1_000_000} megapixels`;
  } else if (format === 'pdf' && Math.max(layout.width, layout.height) > MAX_PDF_SIDE) {
    factor = MAX_PDF_SIDE / Math.max(layout.width, layout.height);
    limited = `${MAX_PDF_SIDE} points per side`;
  }
  if (factor === 1) return layout;
  return {
    width: Math.max(1, Math.floor(layout.width * factor)),
    height: Math.max(1, Math.floor(layout.height * factor)),
    scale: layout.scale * factor,
    limited,
  };
};

const applyTheme = (svg: string, theme: ThemeDefinition): string => {
  const rootStyle = svg.match(/^<svg\b[^>]*\bstyle="([^"]*)"/)?.[1] ?? '';
  const variables: Record<string, string> = {
    ...Object.fromEntries([...rootStyle.matchAll(/(--[\w-]+):([^;]+)/g)].map((match) => [match[1], match[2]])),
    '--pele-bg': theme.colors.background,
    '--pele-fg': theme.colors.foreground,
    '--pele-muted': theme.colors.muted,
    '--pele-line': theme.colors.line,
    '--pele-surface': theme.colors.surface,
    '--pele-surface-alt': theme.colors.surfaceAlt,
    '--pele-border': theme.colors.border,
    '--pele-accent': theme.colors.accent,
    '--pele-radius': `${theme.borderRadius}px`,
  };
  const resolve = (value: string): string => value.replace(
    /var\((--[\w-]+)(?:,([^()]*))?\)/g,
    (_, name: string, fallback: string | undefined) => resolve(variables[name] ?? fallback ?? ''),
  );

  // Resolve presentation attributes, leaving text and identifiers intact.
  return svg.replace(/<[^>]+>/g, (tag) => {
    let result = tag.replace(/(\s(?:style|fill|stroke|font-family)=")([^"]*)"/g,
      (_, prefix: string, value: string) => `${prefix}${resolve(value)}"`);
    const classes = result.match(/\bclass="([^"]*)"/)?.[1].split(' ') ?? [];
    if (classes.includes('pele-er-stripes')) {
      result = result.replace(/\bfill="[^"]*"/, `fill="${theme.colors.surfaceAlt}"`);
    }
    if (classes.includes('pele-er-keys')) {
      result = result.replace(/\bfill="[^"]*"/, `fill="${theme.colors.accent}"`);
    }
    // resvg does not honor SVG 2's CSS rx property. Promote Pele's rounded
    // rectangle styling to an SVG attribute for PNG and PDF as well as SVG.
    if (/^<rect\b/.test(result)) {
      result = result.replace(/\sstyle="([^"]*)"/, (attribute, style: string) => {
        const radius = style.match(/(?:^|;)rx:([^;]+)/)?.[1];
        if (radius === undefined) return attribute;
        const remaining = style.split(';').filter((declaration) => !declaration.startsWith('rx:')).join(';');
        return ` rx="${radius}"${remaining ? ` style="${remaining}"` : ''}`;
      });
    }
    return result;
  });
};

const removeInferredMarkers = (svg: string): string => svg.replace(
  /<g\b[^>]*\bclass="pele-edge pele-er-non-identifying"[^>]*>[\s\S]*?<\/g>/g,
  edge => edge.replace(/<(?:path|circle)\b[^>]*\bclass="pele-marker"[^>]*\/>/g, ''),
);

const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const SANS_SERIF_FONTS = ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans'];

/**
 * Prepares Pele's SVG for resvg, which has two bugs that turn PNG and PDF text serif:
 * - It ignores style declarations that follow a CSS custom property, so it never
 *   sees the font in Pele's root style, which starts with `--_bg:...`.
 * - It resolves the generic `sans-serif` to an arbitrary installed font (Book
 *   Antiqua, a serif, on some Windows machines) and ignores `sansSerifFamily`.
 * The font moves into presentation attributes, with common sans-serif fonts named
 * before the generic. SVG output keeps Pele's markup, which browsers handle.
 */
export const rasterFonts = (svg: string, theme: ThemeDefinition): string => {
  const families = theme.fontFamily.split(',').map((family) => family.trim())
    .flatMap((family) => family === 'sans-serif' ? [...SANS_SERIF_FONTS, family] : [family]);
  const fontFamily = families.map((family) => GENERIC_FONTS.has(family) ? family : `'${family}'`).join(', ');
  return svg.replace(/^<svg\b[^>]*>/, (tag) => tag
    .replace(/\sstyle="([^"]*)"/, (_, style: string) =>
      ` style="${style.split(';').filter((declaration) => !/^\s*font(?:-family)?\s*:/.test(declaration)).join(';')}"`)
    .replace(/>$/, ` font-family="${fontFamily}" font-size="${theme.fontSize}">`));
};

export const renderERD = async (source: string, options: RenderOptions): Promise<Buffer> => {
  const theme = typeof options.theme === 'string' ? resolveTheme(options.theme) : options.theme;
  const diagram = render(source, {
    responsive: false, maxWidth: options.width, fontFamily: theme.fontFamily, fontSize: theme.fontSize,
  });
  const { width, height, scale, limited } = computeLayout(diagram, options.format, options.width, options.height);
  if (limited) {
    const percent = Math.max(1, Math.round(scale * 100));
    options.onWarning?.(`Diagram is ${Math.ceil(diagram.width)}x${Math.ceil(diagram.height)} px; `
      + `${options.format.toUpperCase()} output was reduced to ${width}x${height} (${percent}% scale) to stay within ${limited}. `
      + 'Use SVG output for a full-size diagram.');
  }
  const x = (width - diagram.width * scale) / 2;
  const y = (height - diagram.height * scale) / 2;
  // Mermaid requires cardinalities in source. DuckERD's inference comment
  // identifies diagrams whose dashed edges use placeholders for unknown values.
  const diagramSvg = source.split(/\r?\n/).some(line => line.trim() === INFERRED_RELATIONSHIPS_COMMENT)
    ? removeInferredMarkers(diagram.svg) : diagram.svg;
  const themed = applyTheme(diagramSvg, theme);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${theme.colors.background}"/>
<g transform="translate(${x} ${y}) scale(${scale})">${options.format === 'svg' ? themed : rasterFonts(themed, theme)}</g>
</svg>`;

  if (options.format === 'svg') return Buffer.from(svg);

  const image = new Resvg(svg);
  if (options.format === 'png') return image.render().asPng();

  // Normalize text to vector paths using the same fonts as PNG rendering. This
  // preserves Unicode labels and avoids PDF's limited built-in font encodings.
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: [width, height], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      SVGtoPDF(doc, image.toString(), 0, 0, { assumePt: true });
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
};
