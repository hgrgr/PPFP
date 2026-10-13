/**
 * Turns a drawn chart (a Recharts SVG) into a PNG with a title, a legend and a footer, for
 * putting into a journal or note. The SVG's colors come from CSS variables, which a picture
 * cannot read, so each element's computed colors are written onto a copy before drawing.
 */

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline'];

/** A CSS color (var(--series-1), #fff, ...) as the browser resolves it here */
export function resolveColor(css: string, within: Element = document.body): string {
  const probe = document.createElement('span');
  probe.style.color = css;
  probe.style.display = 'none';
  within.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || css;
}

function inlined(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = to[i] as SVGElement;
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) target.style.setProperty(p, v);
    }
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return copy;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그래프를 그림으로 바꾸지 못했습니다.'));
    img.src = src;
  });
}

export async function chartToPng(
  svg: SVGSVGElement,
  opts: { title: string; legend: { label: string; color: string }[]; footer: string; background?: string; ink?: string; muted?: string },
): Promise<Blob> {
  const scale = 2;
  const w = svg.clientWidth || Number(svg.getAttribute('width')) || 600;
  const h = svg.clientHeight || Number(svg.getAttribute('height')) || 260;
  const copy = inlined(svg);
  copy.setAttribute('width', String(w));
  copy.setAttribute('height', String(h));
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`);

  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const pad = 16;
  const titleH = 28;
  // Legend items wrap onto as many rows as they need
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `12px ${font}`;
  const rows: { label: string; color: string; x: number }[][] = [[]];
  let x = pad;
  for (const item of opts.legend) {
    const iw = 16 + measure.measureText(item.label).width + 14;
    if (x + iw > w + pad && rows.at(-1)!.length) {
      rows.push([]);
      x = pad;
    }
    rows.at(-1)!.push({ ...item, x });
    x += iw;
  }
  const legendH = rows.length * 18 + 6;
  const footH = 20;
  const W = w + pad * 2, H = pad + titleH + h + legendH + footH + pad / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = opts.background ?? '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = opts.ink ?? '#111111';
  g.font = `600 15px ${font}`;
  g.textBaseline = 'top';
  g.fillText(opts.title, pad, pad);
  g.drawImage(img, pad, pad + titleH, w, h);
  g.font = `12px ${font}`;
  rows.forEach((row, ri) => {
    const y = pad + titleH + h + 6 + ri * 18;
    for (const item of row) {
      g.fillStyle = item.color;
      g.fillRect(item.x, y + 2, 10, 10);
      g.fillStyle = opts.ink ?? '#111111';
      g.fillText(item.label, item.x + 15, y);
    }
  });
  g.fillStyle = opts.muted ?? '#6b7280';
  g.font = `11px ${font}`;
  g.fillText(opts.footer, pad, H - footH);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림을 만들지 못했습니다.'))), 'image/png'));
}
