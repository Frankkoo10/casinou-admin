let admUserId = null;
let admCuentasCache = [];
let admMovPorUsuario = {}; // { userId: { depositado, retirado } }, solo solicitudes aprobadas
let admDetalleAbierto = null; // id del jugador con el detalle desplegado, o null

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('adm-login').addEventListener('click', loginAdmin);
    document.getElementById('adm-pass').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginAdmin();
    });
    document.getElementById('adm-logout').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    });
    document.getElementById('adm-buscar-cuenta').addEventListener('input', (e) => {
        renderCuentas(e.target.value.trim().toLowerCase());
    });
});

supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (!session) {
        document.getElementById('adm-gate').classList.remove('hidden');
        document.getElementById('adm-app').classList.add('hidden');
        return;
    }
    admUserId = session.user.id;
    const perfil = await cargarPerfilCompleto(session.user.id);
    if (!perfil || perfil.rol !== 'admin') {
        document.getElementById('adm-gate').classList.remove('hidden');
        document.getElementById('adm-app').classList.add('hidden');
        document.getElementById('adm-gate-msg').innerText = 'Esta cuenta no es admin. En Supabase: UPDATE perfiles SET rol = \'admin\' WHERE id = \'...\'';
        return;
    }
    document.getElementById('adm-gate').classList.add('hidden');
    document.getElementById('adm-app').classList.remove('hidden');
    document.getElementById('adm-who').innerText = perfil.username || session.user.email;
    await cargarTodo();
});

async function loginAdmin() {
    const email = document.getElementById('adm-email').value.trim();
    const password = document.getElementById('adm-pass').value;
    const msg = document.getElementById('adm-gate-msg');
    msg.innerText = 'Entrando...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) msg.innerText = 'Correo o contraseña incorrectos.';
}

async function cargarTodo() {
    await cargarSolicitudes();
    await Promise.all([cargarStats(), cargarCuentas(), cargarMovimientos()]);
}

let admSolicitudesCache = [];
let admSolicitudesError = null;

// Trae TODAS las solicitudes de carga/retiro una sola vez. De acá salen
// tanto las tarjetas de arriba como el detalle por jugador.
async function cargarSolicitudes() {
    const { data, error } = await supabaseClient.from('solicitudes_carga').select('*');
    admSolicitudesCache = data || [];
    admSolicitudesError = error || null;
    if (error) {
        console.error('Error leyendo solicitudes_carga:', error);
    } else {
        console.log('solicitudes_carga: filas recibidas =', admSolicitudesCache.length, admSolicitudesCache.slice(0, 3));
    }
    mostrarDiagnosticoSolicitudes();
    armarMovPorUsuario();
}

// Si no llega nada (o da error), lo más probable es que falte una policy
// de RLS en Supabase que deje al admin ver las solicitudes de TODOS los
// jugadores (por defecto Supabase suele dejar que cada uno vea solo las
// propias). Mostramos un aviso en vez de fallar en silencio.
function mostrarDiagnosticoSolicitudes() {
    const el = document.getElementById('adm-diag-solicitudes');
    if (!el) return;
    if (admSolicitudesError) {
        el.textContent = 'No se pudo leer "solicitudes_carga": ' + admSolicitudesError.message + '. Revisá el nombre de la tabla y los permisos (RLS) en Supabase.';
        el.classList.remove('hidden');
    } else if (admSolicitudesCache.length === 0) {
        el.textContent = 'La tabla "solicitudes_carga" te devolvió 0 filas. Si sabés que hay cargas/retiros hechos, es casi seguro un tema de RLS: por defecto cada jugador solo puede leer sus propias filas, y al admin le falta una policy para ver las de todos. Mirá sql-cambios.sql.';
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function normalizar(v) {
    return String(v || '').trim().toLowerCase();
}

function esAprobada(s) {
    return normalizar(s.estado).includes('aprob');
}

function esRetiro(s) {
    const tipo = normalizar(s.tipo || s.metodo);
    return tipo.includes('ret');
}

// Junta, por cada jugador, cuánto cargó y cuánto retiró (solo solicitudes
// ya aprobadas). Se usa para el detalle de ganancia/pérdida por jugador.
function armarMovPorUsuario() {
    admMovPorUsuario = {};
    admSolicitudesCache.forEach((s) => {
        if (!esAprobada(s)) return;
        const uid = s.user_id;
        if (!uid) return;
        if (!admMovPorUsuario[uid]) admMovPorUsuario[uid] = { depositado: 0, retirado: 0 };
        if (esRetiro(s)) admMovPorUsuario[uid].retirado += Number(s.monto || 0);
        else admMovPorUsuario[uid].depositado += Number(s.monto || 0);
    });
}

// Duración en segundos -> "Xh Ym". Si no hay dato (columna no existe todavía
// o el jugador nunca generó tiempo registrado), avisa que no está disponible.
function formatDuracion(seg) {
    if (seg === null || seg === undefined || Number.isNaN(Number(seg))) return 'No disponible';
    const total = Math.max(0, Math.floor(Number(seg)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h === 0 && m === 0) return 'Menos de 1 min';
    if (h === 0) return `${m} min`;
    return `${h}h ${m}min`;
}

async function cargarStats() {
    const lista = admSolicitudesCache;
    const aprobadas = lista.filter(esAprobada);
    const totalDep = aprobadas.filter((s) => !esRetiro(s)).reduce((sum, s) => sum + Number(s.monto || 0), 0);
    const totalRet = aprobadas.filter(esRetiro).reduce((sum, s) => sum + Number(s.monto || 0), 0);
    const pendientes = lista.filter((s) => normalizar(s.estado).includes('pend')).length;

    document.getElementById('adm-total-dep').innerText = formatMoney(totalDep);
    document.getElementById('adm-total-ret').innerText = formatMoney(totalRet);
    document.getElementById('adm-cant-pendientes').innerText = String(pendientes);

    const { data: perfiles } = await supabaseClient.from('perfiles').select('rol');
    const p = perfiles || [];
    const jugadores = p.filter((x) => (x.rol || 'jugador') === 'jugador').length;
    const operadores = p.filter((x) => x.rol === 'operador' || x.rol === 'admin').length;
    document.getElementById('adm-cant-jugadores').innerText = String(jugadores);
    document.getElementById('adm-cant-operadores').innerText = String(operadores);
}

async function cargarCuentas() {
    const { data, error } = await supabaseClient
        .from('perfiles')
        .select('*')
        .order('username', { ascending: true });
    if (error) {
        document.getElementById('adm-cuentas-body').innerHTML = '<tr><td colspan="7">Corrê el SQL de perfiles para ver las cuentas.</td></tr>';
        return;
    }
    admCuentasCache = data || [];
    renderCuentas('');
}

function renderCuentas(filtro) {
    const body = document.getElementById('adm-cuentas-body');
    let lista = admCuentasCache;
    if (filtro) lista = lista.filter((c) => (c.username || '').toLowerCase().includes(filtro));
    if (!lista.length) {
        body.innerHTML = '<tr><td colspan="7">Sin resultados.</td></tr>';
        return;
    }
    body.innerHTML = lista.map((c) => {
        const rol = c.rol || 'jugador';
        const filas = [`<tr data-id="${c.id}">
            <td>${escapeHtml(c.username || c.id.slice(0, 8))}</td>
            <td>${escapeHtml(rol)}</td>
            <td>${formatMoney(c.saldo || 0)}</td>
            <td>${formatMoney(c.total_apostado || 0)}</td>
            <td>
                <select class="adm-rol-select">
                    <option value="jugador" ${rol === 'jugador' ? 'selected' : ''}>Jugador</option>
                    <option value="operador" ${rol === 'operador' ? 'selected' : ''}>Operador</option>
                    <option value="admin" ${rol === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            </td>
            <td><button type="button" class="adm-guardar-rol">Guardar</button></td>
            <td><button type="button" class="adm-ver-detalle">${admDetalleAbierto === c.id ? 'Ocultar' : 'Detalle'}</button></td>
        </tr>`];
        if (admDetalleAbierto === c.id) {
            filas.push(`<tr class="adm-detalle-row" data-detalle-de="${c.id}"><td colspan="7">${renderDetalleJugador(c)}</td></tr>`);
        }
        return filas.join('');
    }).join('');

    body.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        tr.querySelector('.adm-guardar-rol').addEventListener('click', () => guardarRol(id, tr.querySelector('.adm-rol-select').value, tr));
        tr.querySelector('.adm-ver-detalle').addEventListener('click', () => {
            admDetalleAbierto = admDetalleAbierto === id ? null : id;
            renderCuentas(document.getElementById('adm-buscar-cuenta').value.trim().toLowerCase());
        });
    });

    const detalleRow = body.querySelector('.adm-detalle-row');
    if (detalleRow) {
        const id = detalleRow.dataset.detalleDe;
        detalleRow.querySelectorAll('[data-excluir]').forEach((btn) => {
            btn.addEventListener('click', () => aplicarExclusion(id, btn.dataset.excluir));
        });
        const btnQuitar = detalleRow.querySelector('[data-quitar-exclusion]');
        if (btnQuitar) btnQuitar.addEventListener('click', () => quitarExclusion(id));
    }
}

function renderDetalleJugador(c) {
    const mov = admMovPorUsuario[c.id] || { depositado: 0, retirado: 0 };
    const saldo = Number(c.saldo || 0);
    const neto = saldo + mov.retirado - mov.depositado;
    const netoEsGanancia = neto >= 0;
    const estado = timeoutActivo(c); // helper de shared.js

    let estadoTexto = 'Activo, sin restricciones';
    let estadoClase = 'adm-estado-ok';
    if (estado && estado.tipo === 'cerrada') {
        estadoTexto = 'Cuenta cerrada definitivamente';
        estadoClase = 'adm-estado-mal';
    } else if (estado && estado.tipo === 'autoexclusion') {
        estadoTexto = `Autoexcluido hasta ${formatFecha(estado.until.toISOString())}`;
        estadoClase = 'adm-estado-mal';
    } else if (estado && estado.tipo === 'descanso') {
        estadoTexto = `En pausa hasta ${formatFecha(estado.until.toISOString())}`;
        estadoClase = 'adm-estado-mal';
    }

    return `
    <div class="adm-detalle-panel">
        <div class="adm-detalle-grid">
            <div><span>Depositado (aprobado)</span><strong>${formatMoney(mov.depositado)}</strong></div>
            <div><span>Retirado (aprobado)</span><strong>${formatMoney(mov.retirado)}</strong></div>
            <div><span>Saldo actual</span><strong>${formatMoney(saldo)}</strong></div>
            <div><span>Volumen apostado</span><strong>${formatMoney(c.total_apostado || 0)}</strong></div>
            <div><span>Resultado neto</span><strong class="${netoEsGanancia ? 'adm-ganancia' : 'adm-perdida'}">${netoEsGanancia ? 'Ganancia +' : 'Pérdida '}${formatMoney(Math.abs(neto))}</strong></div>
            <div><span>Tiempo conectado (total)</span><strong>${formatDuracion(c.tiempo_conectado_seg)}</strong></div>
            <div><span>Última conexión</span><strong>${c.last_seen ? formatFecha(c.last_seen) : 'No disponible'}</strong></div>
        </div>
        <p class="adm-estado-linea ${estadoClase}">Estado: ${estadoTexto}</p>
        <div class="adm-exclusion-botones">
            <button type="button" data-excluir="12">Excluir 12 hs</button>
            <button type="button" data-excluir="24">Excluir 24 hs</button>
            <button type="button" data-excluir="48">Excluir 48 hs</button>
            <button type="button" data-excluir="def" class="adm-btn-definitivo">Excluir definitivamente</button>
            ${estado ? '<button type="button" data-quitar-exclusion class="adm-btn-quitar">Quitar exclusión</button>' : ''}
        </div>
    </div>`;
}

async function aplicarExclusion(id, valor) {
    const esDefinitiva = valor === 'def';
    const confirmMsg = esDefinitiva
        ? '¿Cerrar esta cuenta definitivamente por juego problemático? El jugador no va a poder volver a entrar hasta que un admin lo reactive.'
        : `¿Excluir a este jugador por ${valor} horas? No va a poder jugar hasta que pase ese tiempo.`;
    if (!confirm(confirmMsg)) return;

    const update = esDefinitiva
        ? { cuenta_cerrada: true }
        : { timeout_until: new Date(Date.now() + Number(valor) * 3600000).toISOString() };

    const { error } = await supabaseClient.from('perfiles').update(update).eq('id', id);
    if (error) {
        alert('Error al aplicar la exclusión: ' + error.message);
        return;
    }
    await cargarCuentas();
}

async function quitarExclusion(id) {
    if (!confirm('¿Reactivar esta cuenta y sacarle cualquier exclusión o pausa activa?')) return;
    const { error } = await supabaseClient.from('perfiles')
        .update({ timeout_until: null, autoexclusion_until: null, cuenta_cerrada: false })
        .eq('id', id);
    if (error) {
        alert('Error al reactivar la cuenta: ' + error.message);
        return;
    }
    await cargarCuentas();
}

async function guardarRol(id, nuevoRol, tr) {
    if (id === admUserId && nuevoRol !== 'admin') {
        if (!confirm('Te vas a sacar el rol admin a vos mismo y vas a perder acceso a este panel. ¿Seguro?')) return;
    }
    const btn = tr.querySelector('.adm-guardar-rol');
    btn.disabled = true;
    btn.innerText = '...';
    const { error } = await supabaseClient.from('perfiles').update({ rol: nuevoRol }).eq('id', id);
    btn.disabled = false;
    btn.innerText = 'Guardar';
    if (error) {
        alert('Error: ' + error.message);
        return;
    }
    await cargarStats();
    await cargarCuentas();
}

async function cargarMovimientos() {
    const box = document.getElementById('adm-tx-lista');
    const { data, error } = await supabaseClient
        .from('transacciones')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);
    if (error) {
        box.innerHTML = '<p class="empty-msg">Corrê el SQL de transacciones para ver movimientos.</p>';
        return;
    }
    if (!data || !data.length) {
        box.innerHTML = '<p class="empty-msg">Sin movimientos todavía.</p>';
        return;
    }
    const perfiles = {};
    admCuentasCache.forEach((c) => { perfiles[c.id] = c.username; });
    box.innerHTML = data.map((t) => `<div class="acc-line">
        <span>${escapeHtml(perfiles[t.user_id] || 'Jugador ' + String(t.user_id).slice(0, 6))} · ${escapeHtml(t.tipo)} · ${escapeHtml(t.descripcion || '')}<br><small>${formatFecha(t.created_at)}</small></span>
        <strong>${formatMoney(t.monto)}</strong>
    </div>`).join('');
}
