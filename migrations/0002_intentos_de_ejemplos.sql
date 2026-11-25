-- Cuántas veces se intentó aplicar un evento de ejemplo. Si falla varias veces se descarta (aplicado = 2) para que
-- un evento dañado no se reintente sin fin ni estorbe a los demás.
ALTER TABLE ejemplos ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0;
