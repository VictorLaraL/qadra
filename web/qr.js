// Dibujo del QR CoDi. Usa qrcode-generator 1.4.4 (/vendor), cargado como script global.

const TINTA = "#0E1A33";
const MARGEN = 4; // zona de silencio en módulos: lo mínimo que pide el estándar para que el QR se lea bien

let listo = false;
function crearQr(texto) {
  const qrcode = globalThis.qrcode;
  if (!listo) {
    // La librería trae Shift-JIS por omisión; CoDi usa UTF-8. Se configura una sola vez.
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    listo = true;
  }
  const qr = qrcode(0, "M");
  qr.addData(texto, "Byte");
  qr.make();
  return qr;
}

/** SVG del QR con su zona de silencio; escala al tamaño de su contenedor. */
export function svgQr(texto, { color = TINTA, margen = MARGEN } = {}) {
  const qr = crearQr(texto);
  const n = qr.getModuleCount();
  let trazo = "";
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(fila, col)) trazo += `M${col + margen} ${fila + margen}h1v1h-1z`;
    }
  }
  const lado = n + margen * 2;
  return (
    `<svg viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="Código QR CoDi">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/><path d="${trazo}" fill="${color}"/></svg>`
  );
}

/** Descarga el QR como PNG: muchas apps de banco leen el QR desde una imagen guardada en el mismo celular. */
export function descargarPng(texto, nombreArchivo, escala = 12) {
  const qr = crearQr(texto);
  const n = qr.getModuleCount();
  const margen = MARGEN;
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = (n + margen * 2) * escala;
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.fillStyle = TINTA;
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(fila, col)) ctx.fillRect((col + margen) * escala, (fila + margen) * escala, escala, escala);
    }
  }
  const enlace = document.createElement("a");
  enlace.href = lienzo.toDataURL("image/png");
  enlace.download = nombreArchivo;
  enlace.click();
}
