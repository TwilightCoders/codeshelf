/**
 * Pure SVG-embedding rules for posters. Kept out of the panel/message-router
 * layer because these change on a different axis (CSP / defense-in-depth /
 * scaling) and are fully unit-testable without the VS Code API.
 */

/**
 * Strip active content from SVG markup before it is injected via
 * dangerouslySetInnerHTML. The webview CSP already blocks inline <script>,
 * but SVG can also carry event-handler attributes, <foreignObject> HTML, and
 * javascript: URLs — remove those as defense-in-depth.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/((?:xlink:)?href)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/((?:xlink:)?href)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
}

/**
 * Transform raw SVG markup for proper embedding:
 * - Sanitize active content (scripts, event handlers, foreignObject)
 * - Add viewBox from width/height if missing
 * - Strip hardcoded width/height
 * - Add preserveAspectRatio for cover-style scaling
 */
export function transformSvg(svg: string): string | undefined {
  if (!svg.includes('<svg')) return undefined;
  return sanitizeSvg(svg).replace(/<svg([^>]*)>/, (_match: string, attrs: string) => {
    let newAttrs = attrs;
    const wMatch = attrs.match(/width="(\d+)"/);
    const hMatch = attrs.match(/height="(\d+)"/);
    if (!attrs.includes('viewBox') && wMatch && hMatch) {
      newAttrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
    }
    newAttrs = newAttrs.replace(/\s*width="[^"]*"/g, '');
    newAttrs = newAttrs.replace(/\s*height="[^"]*"/g, '');
    if (!newAttrs.includes('preserveAspectRatio')) {
      newAttrs += ' preserveAspectRatio="xMidYMid slice"';
    }
    return `<svg${newAttrs}>`;
  });
}
