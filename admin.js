let admUserId = null;
let admCuentasCache = [];

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
    insertarBotonAyuda();
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
    await Promise.all([cargarStats(), cargarCuentas(), cargarMovimientos()]);
}

async function cargarStats() {
    const { data: solicitudes } = await supabaseClient.from('solicitudes_carga').select('*');
    const lista = solicitudes || [];
    const aprobadas = lista.filter((s) => s.estado === 'aprobada');
    const totalDep = aprobadas
        .filter((s) => (s.tipo || (s.metodo === 'retiro' ? 'retiro' : 'deposito')) === 'deposito')
        .reduce((sum, s) => sum + Number(s.monto || 0), 0);
    const totalRet = aprobadas
        .filter((s) => (s.tipo || (s.metodo === 'retiro' ? 'retiro' : 'deposito')) === 'retiro')
        .reduce((sum, s) => sum + Number(s.monto || 0), 0);
    const pendientes = lista.filter((s) => s.estado === 'pendiente').length;

    document.getElementById('adm-total-dep').innerText = formatMoney(totalDep);
    document.getElementById('adm-total-ret').innerText = formatMoney(totalRet);
    document.getElementById('adm-cant-pendientes').innerText = String(pendientes);

    const { data: perfiles } = await supabaseClient.from('perfiles').select('rol, total_apostado');
    const p = perfiles || [];
    const totalApostado = p.reduce((sum, x) => sum + Number(x.total_apostado || 0), 0);
    const jugadores = p.filter((x) => (x.rol || 'jugador') === 'jugador').length;
    const operadores = p.filter((x) => x.rol === 'operador' || x.rol === 'admin').length;
    document.getElementById('adm-total-apostado').innerText = formatMoney(totalApostado);
    document.getElementById('adm-cant-jugadores').innerText = String(jugadores);
    document.getElementById('adm-cant-operadores').innerText = String(operadores);
}

async function cargarCuentas() {
    const { data, error } = await supabaseClient
        .from('perfiles')
        .select('id, username, rol, saldo, total_apostado')
        .order('username', { ascending: true });
    if (error) {
        document.getElementById('adm-cuentas-body').innerHTML = '<tr><td colspan="6">Corrê el SQL de perfiles para ver las cuentas.</td></tr>';
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
        body.innerHTML = '<tr><td colspan="6">Sin resultados.</td></tr>';
        return;
    }
    body.innerHTML = lista.map((c) => {
        const rol = c.rol || 'jugador';
        return `<tr data-id="${c.id}">
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
        </tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr) => {
        const id = tr.dataset.id;
        tr.querySelector('.adm-guardar-rol').addEventListener('click', () => guardarRol(id, tr.querySelector('.adm-rol-select').value, tr));
    });
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
