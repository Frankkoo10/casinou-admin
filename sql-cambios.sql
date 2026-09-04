-- ============================================================
-- Cambios opcionales en Supabase para que el panel admin pueda
-- mostrar "tiempo conectado" por jugador.
--
-- El panel admin YA funciona sin esto (muestra "No disponible"
-- en esa columna). Corré esto solo si querés activar esa métrica.
-- ============================================================

alter table perfiles add column if not exists tiempo_conectado_seg integer default 0;
alter table perfiles add column if not exists last_seen timestamptz;

-- Estas seguramente ya las tenés (shared.js ya las usa), pero por
-- las dudas si alguna falta:
alter table perfiles add column if not exists timeout_until timestamptz;
alter table perfiles add column if not exists autoexclusion_until timestamptz;
alter table perfiles add column if not exists cuenta_cerrada boolean default false;

-- ============================================================
-- ESTO ES LO MÁS PROBABLE QUE TE ESTÉ FALTANDO:
--
-- Si en el panel admin los totales de depositado/retirado te dan $0
-- (aunque sepas que hay cargas y retiros reales), es casi seguro que
-- "solicitudes_carga" tiene Row Level Security activado y cada jugador
-- solo puede leer SUS PROPIAS filas. El admin entonces ve la tabla
-- "vacía" porque no tiene filas propias, no porque no haya datos.
--
-- Agregale una policy que le permita a cualquier cuenta con rol admin
-- ver TODAS las filas. Ajustá el nombre de la tabla si la tuya se
-- llama distinto.
-- ============================================================

drop policy if exists "Admins ven todas las solicitudes" on solicitudes_carga;
create policy "Admins ven todas las solicitudes"
on solicitudes_carga for select
to authenticated
using (
    exists (
        select 1 from perfiles
        where perfiles.id = auth.uid() and perfiles.rol = 'admin'
    )
);

-- Lo mismo para transacciones, por si "Movimientos recientes" también
-- te aparece vacío:
drop policy if exists "Admins ven todas las transacciones" on transacciones;
create policy "Admins ven todas las transacciones"
on transacciones for select
to authenticated
using (
    exists (
        select 1 from perfiles
        where perfiles.id = auth.uid() and perfiles.rol = 'admin'
    )
);
