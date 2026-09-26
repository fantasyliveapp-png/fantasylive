/**
 * MARCA DE AGUA del contenido de pago.
 *
 * Lleva el @usuario de quien lo mira y un trozo de su id (por si cambia de
 * nombre), repetido en diagonal por toda la imagen: recortarla no basta para
 * quitarla. Es tenue para no estropear la foto, pero sobrevive a capturas.
 */

/**
 * Apagada: las fotos y videos de pago se ven limpios, sin el @ de quien los
 * mira. Siguen protegidos (sin clic derecho ni descarga, y solo quien pago
 * puede abrirlos). Poner a true para volver a marcarlos.
 */
export const SHOW_WATERMARK = false;

/** Texto de la marca para una cuenta. */
export function watermarkLabel(username: string | null, userId: string): string {
  const ref = userId.slice(-6).toUpperCase();
  return username ? `@${username} · ${ref}` : `ID ${ref}`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

/** SVG del tamano de la imagen con la marca repetida en diagonal. */
export function watermarkSvg(width: number, height: number, label: string): string {
  const text = escapeXml(`${label}  ·  FantasyLive`);
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 26));
  const stepX = Math.round(fontSize * text.length * 0.62);
  const stepY = Math.round(fontSize * 4.2);
  const diagonal = Math.ceil(Math.hypot(width, height));

  const rows: string[] = [];
  let row = 0;
  for (let y = -diagonal; y < diagonal; y += stepY, row += 1) {
    // Filas alternas desplazadas, como un ladrillo: sin huecos limpios.
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = -diagonal + offset; x < diagonal; x += stepX) {
      rows.push(`<text x="${Math.round(x)}" y="${y}">${text}</text>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g transform="translate(${width / 2} ${height / 2}) rotate(-30)"
     font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700"
     fill="#ffffff" fill-opacity="0.16" stroke="#000000" stroke-opacity="0.12" stroke-width="${Math.max(1, fontSize / 18)}">
    ${rows.join('\n    ')}
  </g>
  <text x="${width - fontSize * 0.8}" y="${height - fontSize * 0.8}" text-anchor="end"
     font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.8)}" font-weight="700"
     fill="#ffffff" fill-opacity="0.7" stroke="#000000" stroke-opacity="0.45" stroke-width="1">${escapeXml(label)}</text>
</svg>`;
}
