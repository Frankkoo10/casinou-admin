alter table perfiles add column if not exists tiempo_conectado_seg integer default 0;
alter table perfiles add column if not exists last_seen timestamptz;

alter table perfiles add column if not exists timeout_until timestamptz;
alter table perfiles add column if not exists autoexclusion_until timestamptz;
alter table perfiles add column if not exists cuenta_cerrada boolean default false;

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
