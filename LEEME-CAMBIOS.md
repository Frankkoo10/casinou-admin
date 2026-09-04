# Qué se agregó al panel admin

## Última vuelta de cambios

- Saqué la tarjeta **"Total apostado (histórico)"** de arriba (la de
  volumen apostado por jugador individual la dejé, está en el Detalle).
- Los totales de **depositado/retirado** ahora comparan `estado` y `tipo`
  sin importar mayúsculas/espacios, para no fallar por diferencias de
  formato en esos textos.
- Agregué un **aviso automático** arriba del panel: si `solicitudes_carga`
  devuelve 0 filas o da error, te dice por qué (mirá la consola del
  navegador también, ahí queda logueado el detalle).
- **La causa más probable** de que depósitos/retiros te aparezcan en $0
  es que la tabla `solicitudes_carga` tiene RLS (seguridad a nivel de
  fila) y cada jugador solo puede leer sus propias filas — el admin, al
  no tener filas propias, ve la tabla "vacía". Corré la parte nueva de
  `sql-cambios.sql` (la policy para admins) en el SQL Editor de Supabase
  y probá de nuevo.


1. **Se sacó** el bloque de "Material de prevención" (video) y el botón
   flotante de la línea de ayuda del panel de admin (`index.html` y
   `admin.js`). Seguían ahí solo por copiar la estructura de las otras
   pantallas del proyecto; no tienen sentido en la vista del admin.

2. **Detalle por jugador**: en la tabla de "Cuentas" ahora hay un botón
   **Detalle** por fila. Al abrirlo muestra:
   - Depositado y retirado (aprobados)
   - Saldo actual
   - Volumen apostado
   - **Resultado neto** (ganancia o pérdida), calculado como:
     `saldo actual + retirado - depositado`
     Ejemplo: carga $1000 y pierde todo → saldo $0 → resultado **-$1000**.
     Carga $1000 y termina con $5000 → resultado **+$4000** (la ganancia,
     aparte de lo que cargó).
   - Tiempo conectado y última conexión (ver punto 3)
   - Estado actual (activo / en pausa / autoexcluido / cuenta cerrada)

3. **Botones de autoexclusión** (12 hs, 24 hs, 48 hs, definitiva) y un
   botón para reactivar la cuenta. Usan las columnas que `shared.js` ya
   esperaba (`timeout_until`, `autoexclusion_until`, `cuenta_cerrada`),
   así que si ya las tenías creadas en Supabase, esto funciona directo.

4. **Tiempo conectado**: esto NO estaba en ningún lado del proyecto — ni
   en este zip (que es solo el panel admin) ni en el esquema de datos.
   Para que funcione de verdad hace falta que la app del **jugador**
   (que no me pasaste) vaya guardando cuánto tiempo estuvo conectado.
   El panel admin ya está preparado para mostrarlo apenas exista el
   dato; mientras tanto muestra "No disponible" sin romper nada.

   Para activarlo:
   - Corré `sql-cambios.sql` en Supabase (agrega `tiempo_conectado_seg`
     y `last_seen` a `perfiles`).
   - En la app del jugador, ya logueado, agregá algo como esto (por
     ejemplo cada 30 segundos mientras la pestaña está abierta):

     ```js
     setInterval(async () => {
       const { data: { user } } = await supabaseClient.auth.getUser();
       if (!user) return;
       const { data: perfil } = await supabaseClient
         .from('perfiles').select('tiempo_conectado_seg').eq('id', user.id).single();
       const actual = Number(perfil?.tiempo_conectado_seg || 0);
       await supabaseClient.from('perfiles').update({
         tiempo_conectado_seg: actual + 30,
         last_seen: new Date().toISOString()
       }).eq('id', user.id);
     }, 30000);
     ```

   Es una versión simple (no es 100% exacta si el jugador tiene varias
   pestañas abiertas), pero para un proyecto de escuela sirve perfecto.
