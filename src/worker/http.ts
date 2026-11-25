// Respuestas y lecturas HTTP comunes del Worker.

export function json(datos: unknown, status = 200): Response {
  return Response.json(datos, { status, headers: { "cache-control": "no-store" } });
}

export function texto(cuerpo: string, status = 200): Response {
  return new Response(cuerpo, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** Lee el valor de `Authorization: Bearer <token>`, o cadena vacía. */
export function tokenBearer(request: Request): string {
  const valor = request.headers.get("authorization") ?? "";
  return valor.startsWith("Bearer ") ? valor.slice(7).trim() : "";
}

/**
 * Lee el cuerpo de una solicitud como texto sin pasar de `maximoBytes`. Regresa null si es más grande.
 * Si viene Content-Length se rechaza sin leer; si no viene (envío por partes), se deja de leer en cuanto se rebasa
 * el límite, para que nadie pueda hacer que el Worker cargue en memoria un cuerpo enorme.
 */
export async function leerTextoLimitado(request: Request, maximoBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maximoBytes) return null;
  if (!request.body) return "";

  const lector = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximoBytes) {
      await lector.cancel();
      return null;
    }
    partes.push(value);
  }
  const todo = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    todo.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return new TextDecoder().decode(todo);
}

/** Lee un cuerpo JSON pequeño. Regresa null si es demasiado grande o no es JSON. */
export async function leerJson(request: Request, maximoBytes = 8 * 1024): Promise<unknown | null> {
  const cuerpo = await leerTextoLimitado(request, maximoBytes);
  if (cuerpo === null) return null;
  try {
    return JSON.parse(cuerpo) as unknown;
  } catch {
    return null;
  }
}

export function log(evento: string, datos: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evento, ...datos }));
}
