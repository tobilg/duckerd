import { Resvg } from '@resvg/resvg-js';
import { render } from 'pele';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { resolveTheme, Theme, ThemeDefinition } from './themes';

export { themeNames, type Theme } from './themes';

export const outputFormats = ['svg', 'png', 'pdf'] as const;
export type OutputFormat = typeof outputFormats[number];

export interface RenderOptions {
  format: OutputFormat;
  theme: Theme | ThemeDefinition;
  width: number;
  height: number;
}

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

export const renderERD = async (source: string, options: RenderOptions): Promise<Buffer> => {
  const theme = typeof options.theme === 'string' ? resolveTheme(options.theme) : options.theme;
  const diagram = render(source, {
    responsive: false, maxWidth: options.width, fontFamily: theme.fontFamily, fontSize: theme.fontSize,
  });
  const scale = Math.min(options.width / diagram.width, options.height / diagram.height);
  const x = (options.width - diagram.width * scale) / 2;
  const y = (options.height - diagram.height * scale) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">
<rect width="100%" height="100%" fill="${theme.colors.background}"/>
<g transform="translate(${x} ${y}) scale(${scale})">${applyTheme(diagram.svg, theme)}</g>
</svg>`;

  if (options.format === 'svg') return Buffer.from(svg);

  const image = new Resvg(svg);
  if (options.format === 'png') return image.render().asPng();

  // Normalize text to vector paths using the same fonts as PNG rendering. This
  // preserves Unicode labels and avoids PDF's limited built-in font encodings.
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: [options.width, options.height], margin: 0 });
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
