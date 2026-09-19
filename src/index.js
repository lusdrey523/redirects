export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const code = path.slice(1).toUpperCase().trim();

    if (path.startsWith("/admin")) {
      return handleAdmin(request, env, path);
    }

    if (!code) {
      return new Response(homePage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    try {
      if (!env.DEVICES) {
        return new Response(errorPage("Binding DEVICES no configurado"), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      const raw = await env.DEVICES.get(code);

      if (!raw) {
        return new Response(notConfiguredPage(code), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return new Response(notConfiguredPage(code), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      if (data.status === "configured" && data.reviewUrl) {
        data.scans = (Number(data.scans) || 0) + 1;
        data.lastUsed = new Date().toISOString();
        try {
          await env.DEVICES.put(code, JSON.stringify(data));
        } catch (e) {
          console.error("KV put error:", e);
        }
        return Response.redirect(data.reviewUrl, 302);
      }

      return new Response(notConfiguredPage(code), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (err) {
      console.error("Redirect error:", err);
      return new Response(errorPage(String(err.message || err)), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }
};

async function handleAdmin(request, env, path) {
  const cookie = request.headers.get("Cookie") || "";
  const isLoggedIn = cookie.includes("breto_admin=1");
  const origin = new URL(request.url).origin;

  if (path === "/admin/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": origin + "/admin",
        "Set-Cookie": "breto_admin=; Path=/; Max-Age=0"
      }
    });
  }

  if (path === "/admin" && request.method === "POST") {
    try {
      const form = await request.formData();
      const password = form.get("password");
      if (!env.ADMIN_PASSWORD) {
        return new Response(loginPage(true, "ADMIN_PASSWORD no configurado"), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (password === env.ADMIN_PASSWORD) {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": origin + "/admin/dispositivos",
            "Set-Cookie": "breto_admin=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400"
          }
        });
      }
      return new Response(loginPage(true), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (e) {
      return new Response(loginPage(true, "Error al procesar login"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (!isLoggedIn) {
    return new Response(loginPage(false), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (path === "/admin/new" && request.method === "POST") {
    try {
      const form = await request.formData();
      const newCode = (form.get("code") || "").toUpperCase().trim();
      if (!newCode) {
        return new Response(null, {
          status: 302,
          headers: { "Location": origin + "/admin/dispositivos" }
        });
      }
      const exists = await env.DEVICES.get(newCode);
      if (!exists) {
        await env.DEVICES.put(newCode, JSON.stringify({
          status: "pending",
          businessName: null,
          reviewUrl: null,
          scans: 0,
          createdAt: new Date().toISOString()
        }));
      }
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/edit/" + newCode }
      });
    } catch (e) {
      return new Response(errorPage("Error al crear dispositivo: " + e.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (path.startsWith("/admin/edit/") && request.method === "POST") {
    try {
      const deviceCode = path.replace("/admin/edit/", "").toUpperCase();
      const form = await request.formData();
      const businessName = (form.get("businessName") || "").trim();
      const reviewUrl = (form.get("reviewUrl") || "").trim();
      const existingRaw = await env.DEVICES.get(deviceCode);
      let data = {};
      if (existingRaw) {
        try { data = JSON.parse(existingRaw); } catch (e) { data = {}; }
      }
      data.businessName = businessName || null;
      data.reviewUrl = reviewUrl || null;
      data.status = reviewUrl ? "configured" : "pending";
      data.updatedAt = new Date().toISOString();
      if (typeof data.scans !== "number") data.scans = 0;
      await env.DEVICES.put(deviceCode, JSON.stringify(data));
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/dispositivos" }
      });
    } catch (e) {
      return new Response(errorPage("Error al guardar: " + e.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (path.startsWith("/admin/edit/")) {
    const deviceCode = path.replace("/admin/edit/", "").toUpperCase();
    const raw = await env.DEVICES.get(deviceCode);
    let data = { businessName: "", reviewUrl: "", status: "pending", scans: 0 };
    if (raw) {
      try { data = { ...data, ...JSON.parse(raw) }; } catch (e) {}
    }
    return new Response(editFormPage(deviceCode, data), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (path === "/admin/new") {
    return new Response(newDevicePage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (path === "/admin/dispositivos" || path === "/admin") {
    try {
      const list = await env.DEVICES.list();
      const devices = [];
      for (const key of list.keys) {
        const raw = await env.DEVICES.get(key.name);
        if (raw) {
          try {
            const data = JSON.parse(raw);
            devices.push({
              code: key.name,
              businessName: data.businessName || "—",
              status: data.status || "pending",
              scans: data.scans || 0,
              lastUsed: data.lastUsed || null
            });
          } catch (e) {
            devices.push({ code: key.name, businessName: "Error", status: "error", scans: 0, lastUsed: null });
          }
        }
      }
      devices.sort((a, b) => a.code.localeCompare(b.code));
      return new Response(adminListPage(devices), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (e) {
      return new Response(errorPage("Error al cargar lista: " + e.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (path === "/admin/inicio") {
    try {
      const list = await env.DEVICES.list();
      let total = 0, configured = 0, pending = 0, totalScans = 0;
      for (const key of list.keys) {
        total++;
        const raw = await env.DEVICES.get(key.name);
        if (raw) {
          try {
            const d = JSON.parse(raw);
            if (d.status === "configured") configured++;
            else pending++;
            totalScans += Number(d.scans) || 0;
          } catch (e) {}
        }
      }
      return new Response(adminHomePage({ total, configured, pending, totalScans }), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (e) {
      return new Response(adminHomePage({ total: 0, configured: 0, pending: 0, totalScans: 0 }), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  const placeholders = ["clientes", "pedidos", "packs", "comprar", "tarifas", "contacto"];
  for (const p of placeholders) {
    if (path === "/admin/" + p) {
      return new Response(placeholderPage(p), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  return new Response(null, {
    status: 302,
    headers: { "Location": origin + "/admin/dispositivos" }
  });
}

/* ==================== DESIGN SYSTEM ==================== */

function sidebar(active = "dispositivos") {
  const items = [
    { id: "inicio", label: "Inicio", href: "/admin/inicio" },
    { id: "dispositivos", label: "Dispositivos", href: "/admin/dispositivos" },
    { id: "clientes", label: "Clientes", href: "/admin/clientes", soon: true },
    { id: "pedidos", label: "Pedidos", href: "/admin/pedidos", soon: true },
    { id: "packs", label: "Packs", href: "/admin/packs", soon: true },
    { id: "comprar", label: "Comprar", href: "/admin/comprar", soon: true },
    { id: "tarifas", label: "Tarifas", href: "/admin/tarifas", soon: true },
    { id: "contacto", label: "Contacto", href: "/admin/contacto", soon: true }
  ];

  return `
  <aside class="sidebar">
    <div class="sidebar-top">
      <div class="brand">
        <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
        <span class="brand-sub">Panel Admin</span>
      </div>
      <nav class="nav">
        ${items.map(item => `
          <a href="${item.href}" class="nav-link ${active === item.id ? 'active' : ''} ${item.soon ? 'soon' : ''}">
            <span>${item.label}</span>
            ${item.soon ? '<em>Próx.</em>' : ''}
          </a>
        `).join('')}
      </nav>
    </div>
    <div class="sidebar-bottom">
      <a href="/admin/logout" class="logout">Cerrar sesión</a>
    </div>
  </aside>`;
}

function baseStyles() {
  return `
  :root {
    --bg: #0b1220;
    --panel: #131c2e;
    --panel-2: #1a2538;
    --border: #243047;
    --text: #e8eef7;
    --muted: #8b9bb4;
    --accent: #3b9eff;
    --accent-soft: rgba(59,158,255,.12);
    --ok: #22c55e;
    --ok-bg: rgba(34,197,94,.12);
    --warn: #eab308;
    --warn-bg: rgba(234,179,8,.12);
    --danger: #ef4444;
    --danger-bg: rgba(239,68,68,.12);
    --radius: 12px;
    --font: 'Inter', system-ui, -apple-system, sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:var(--font);
    background:var(--bg);
    color:var(--text);
    min-height:100vh;
    display:flex;
    -webkit-font-smoothing:antialiased;
  }

  /* Sidebar */
  .sidebar{
    width:220px;
    background:var(--panel);
    border-right:1px solid var(--border);
    display:flex;
    flex-direction:column;
    position:fixed;
    top:0;left:0;
    height:100vh;
    z-index:50;
  }
  .sidebar-top{flex:1;overflow-y:auto;padding:20px 14px}
  .brand{text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border)}
  .brand img{max-width:130px;display:block;margin:0 auto 8px}
  .brand-sub{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
  .nav{display:flex;flex-direction:column;gap:2px}
  .nav-link{
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 12px;border-radius:8px;
    color:var(--muted);text-decoration:none;font-size:.9rem;
    transition:all .15s;
  }
  .nav-link:hover{background:var(--panel-2);color:var(--text)}
  .nav-link.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
  .nav-link.soon{opacity:.45;pointer-events:none}
  .nav-link em{font-style:normal;font-size:.65rem;background:var(--panel-2);padding:2px 6px;border-radius:6px;color:var(--muted)}
  .sidebar-bottom{padding:14px;border-top:1px solid var(--border)}
  .logout{
    display:block;text-align:center;
    padding:10px;border-radius:8px;
    background:var(--danger-bg);color:var(--danger);
    text-decoration:none;font-size:.85rem;font-weight:600;
    border:1px solid transparent;
    transition:all .15s;
  }
  .logout:hover{border-color:var(--danger);background:rgba(239,68,68,.2)}

  /* Main */
  .main{margin-left:220px;flex:1;padding:32px;min-height:100vh}
  .page-header{margin-bottom:24px}
  .page-header h1{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}
  .page-header p{color:var(--muted);font-size:.9rem;margin-top:4px}

  /* Cards */
  .card{
    background:var(--panel);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:24px;
  }
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px}
  .stat{
    background:var(--panel);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:18px 16px;
  }
  .stat-label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .stat-value{font-size:1.6rem;font-weight:700}

  /* Table */
  table{width:100%;border-collapse:collapse;font-size:.875rem}
  th,td{padding:12px 10px;text-align:left;border-bottom:1px solid var(--border)}
  th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
  tr:last-child td{border-bottom:none}

  /* Badges */
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600}
  .badge-ok{background:var(--ok-bg);color:var(--ok)}
  .badge-pending{background:var(--warn-bg);color:var(--warn)}

  /* Buttons */
  .btn{
    display:inline-flex;align-items:center;justify-content:center;
    padding:8px 14px;border-radius:8px;font-size:.85rem;font-weight:600;
    text-decoration:none;border:none;cursor:pointer;transition:all .15s;
  }
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover{filter:brightness(1.1)}
  .btn-ghost{background:var(--panel-2);color:var(--text)}
  .btn-ghost:hover{background:var(--border)}
  .btn-block{width:100%;padding:13px}
  .actions{display:flex;gap:10px;margin-top:8px}

  /* Forms */
  label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px;font-weight:500}
  input,textarea{
    width:100%;padding:11px 14px;border-radius:8px;
    border:1px solid var(--border);background:var(--bg);color:var(--text);
    font-size:.95rem;font-family:inherit;margin-bottom:16px;
  }
  input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  textarea{min-height:90px;resize:vertical}
  .hint{font-size:.78rem;color:var(--muted);margin-top:-10px;margin-bottom:16px}
  .code-tag{font-size:1.05rem;color:var(--accent);font-weight:700;letter-spacing:1px;margin-bottom:20px}

  /* Empty / placeholder */
  .empty{text-align:center;padding:48px 20px;color:var(--muted)}
  .empty h2{font-size:1.2rem;color:var(--text);margin-bottom:8px}

  @media(max-width:768px){
    body{flex-direction:column}
    .sidebar{width:100%;height:auto;position:relative;border-right:none}
    .sidebar-top{padding:14px}
    .brand{margin-bottom:12px;padding-bottom:12px}
    .nav{flex-direction:row;flex-wrap:wrap;gap:4px}
    .nav-link{flex:1 1 40%;justify-content:center;font-size:.8rem;padding:8px}
    .nav-link em{display:none}
    .main{margin-left:0;padding:16px}
    .stats{grid-template-columns:1fr 1fr}
  }
  `;
}

/* ==================== PAGES ==================== */

function loginPage(error = false, customMessage = null) {
  const errorMsg = customMessage || (error ? "Contraseña incorrecta" : null);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login – Breto's Services</title>
  <style>
    ${baseStyles()}
    body{align-items:center;justify-content:center;padding:24px}
    .login-card{
      background:var(--panel);border:1px solid var(--border);border-radius:16px;
      padding:40px 32px;max-width:380px;width:100%;text-align:center;
    }
    .login-card img{max-width:180px;margin-bottom:8px}
    .login-card .sub{font-size:.8rem;color:var(--muted);margin-bottom:28px;text-transform:uppercase;letter-spacing:.06em}
    .login-card h1{font-size:1.2rem;margin-bottom:24px}
    .err{background:var(--danger-bg);color:var(--danger);padding:10px;border-radius:8px;margin-bottom:16px;font-size:.85rem}
  </style>
</head>
<body>
  <div class="login-card">
    <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
    <div class="sub">Panel de Administración</div>
    ${errorMsg ? `<div class="err">${errorMsg}</div>` : ''}
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Contraseña" required autofocus>
      <button type="submit" class="btn btn-primary btn-block">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

function adminHomePage(stats = {}) {
  const { total = 0, configured = 0, pending = 0, totalScans = 0 } = stats;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inicio – Breto's Services</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${sidebar("inicio")}
  <main class="main">
    <div class="page-header">
      <h1>Inicio</h1>
      <p>Resumen de tu sistema de reseñas</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-label">Dispositivos</div><div class="stat-value">${total}</div></div>
      <div class="stat"><div class="stat-label">Configurados</div><div class="stat-value" style="color:var(--ok)">${configured}</div></div>
      <div class="stat"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--warn)">${pending}</div></div>
      <div class="stat"><div class="stat-label">Escaneos totales</div><div class="stat-value">${totalScans}</div></div>
    </div>
    <div class="card">
      <p style="color:var(--muted);line-height:1.6">Gestiona tus tarjetas NFC/QR de reseñas Google desde la sección de Dispositivos.</p>
      <a href="/admin/dispositivos" class="btn btn-primary" style="margin-top:18px">Ir a Dispositivos</a>
    </div>
  </main>
</body>
</html>`;
}

function adminListPage(devices) {
  const rows = devices.length === 0
    ? `<tr><td colspan="6"><div class="empty">No hay dispositivos todavía</div></td></tr>`
    : devices.map(d => `
      <tr>
        <td><strong>${d.code}</strong></td>
        <td>${d.businessName}</td>
        <td><span class="badge ${d.status === 'configured' ? 'badge-ok' : 'badge-pending'}">${d.status === 'configured' ? 'Configurado' : 'Pendiente'}</span></td>
        <td>${d.scans}</td>
        <td>${d.lastUsed ? new Date(d.lastUsed).toLocaleString('es-CL') : '—'}</td>
        <td><a href="/admin/edit/${d.code}" class="btn btn-primary" style="padding:6px 12px;font-size:.8rem">Configurar</a></td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dispositivos – Breto's Services</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h1>Dispositivos</h1>
        <p>${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}</p>
      </div>
      <a href="/admin/new" class="btn btn-primary">+ Nuevo dispositivo</a>
    </div>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Negocio</th>
            <th>Estado</th>
            <th>Escaneos</th>
            <th>Último uso</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

function placeholderPage(section) {
  const titles = {
    clientes: "Clientes", pedidos: "Pedidos", packs: "Packs",
    comprar: "Comprar", tarifas: "Tarifas", contacto: "Contacto"
  };
  const title = titles[section] || section;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} – Breto's Services</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${sidebar(section)}
  <main class="main">
    <div class="page-header"><h1>${title}</h1></div>
    <div class="card empty">
      <h2>Próximamente</h2>
      <p>Esta sección estará disponible en una próxima actualización.</p>
    </div>
  </main>
</body>
</html>`;
}

function newDevicePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nuevo dispositivo – Breto's Services</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="page-header">
      <h1>Nuevo dispositivo</h1>
      <p>Crea un código para una tarjeta NFC/QR</p>
    </div>
    <div class="card" style="max-width:440px">
      <form method="POST" action="/admin/new">
        <label>Código del dispositivo</label>
        <input type="text" name="code" placeholder="Ej: BS011" required autofocus style="text-transform:uppercase">
        <p class="hint">Formato recomendado: BS001, BS002…</p>
        <button type="submit" class="btn btn-primary btn-block">Crear y configurar</button>
      </form>
    </div>
  </main>
</body>
</html>`;
}

function editFormPage(code, data) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configurar ${code}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="page-header">
      <h1>Configurar dispositivo</h1>
      <p class="code-tag">${code}</p>
    </div>
    <div class="card" style="max-width:480px">
      <form method="POST" action="/admin/edit/${code}">
        <label>Nombre del negocio</label>
        <input type="text" name="businessName" value="${data.businessName || ''}" placeholder="Ej: Peluquería La Pelu" required>
        <label>Link de reseña de Google</label>
        <textarea name="reviewUrl" placeholder="https://search.google.com/local/writereview?placeid=...">${data.reviewUrl || ''}</textarea>
        <p class="hint">Pega el link completo de “Escribir una reseña”</p>
        <div class="actions">
          <a href="/admin/dispositivos" class="btn btn-ghost" style="flex:1">Cancelar</a>
          <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        </div>
      </form>
    </div>
  </main>
</body>
</html>`;
}

function homePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Breto's Services</title>
  <style>
    ${baseStyles()}
    body{align-items:center;justify-content:center;padding:24px}
    .hero{
      background:var(--panel);border:1px solid var(--border);border-radius:16px;
      padding:48px 32px;max-width:400px;width:100%;text-align:center;
    }
    .hero img{max-width:240px;margin-bottom:16px}
    .hero p{color:var(--muted);font-size:.95rem;line-height:1.5}
  </style>
</head>
<body>
  <div class="hero">
    <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
    <p>Tarjetas de reseñas Google<br>NFC + QR</p>
  </div>
</body>
</html>`;
}

function notConfiguredPage(code) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dispositivo pendiente – Breto's Services</title>
  <style>
    ${baseStyles()}
    body{align-items:center;justify-content:center;padding:24px}
    .pending-card{
      background:var(--panel);border:1px solid var(--border);border-radius:16px;
      padding:40px 28px;max-width:400px;width:100%;text-align:center;
    }
    .pending-card img{max-width:160px;margin-bottom:24px}
    .pending-card h1{font-size:1.25rem;margin-bottom:10px;line-height:1.3}
    .pending-card .sub{color:var(--muted);font-size:.9rem;line-height:1.5;margin-bottom:24px}
    .code-box{
      font-size:1.6rem;font-weight:700;letter-spacing:3px;
      background:var(--bg);color:var(--accent);
      padding:12px 20px;border-radius:10px;display:inline-block;margin-bottom:24px;
      border:1px solid var(--border);
    }
    .code-label{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
    .owner{font-size:.85rem;color:var(--muted);margin-bottom:14px}
    .footer{margin-top:28px;font-size:.75rem;color:var(--muted)}
  </style>
</head>
<body>
  <div class="pending-card">
    <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
    <h1>Este dispositivo todavía no está configurado</h1>
    <p class="sub">En cuanto su propietario lo configure, este enlace te llevará directamente a dejar una reseña en Google.</p>
    <div class="code-label">Código del producto</div>
    <div class="code-box">${code}</div>
    <p class="owner">¿Eres el propietario de este dispositivo?</p>
    <a href="/admin" class="btn btn-primary">Configúralo desde tu panel</a>
    <p class="footer">Breto's Services · Tarjetas de reseñas Google + NFC/QR</p>
  </div>
</body>
</html>`;
}

function errorPage(message = "Error temporal") {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error – Breto's Services</title>
  <style>
    ${baseStyles()}
    body{align-items:center;justify-content:center;padding:24px}
    .err-card{
      background:var(--panel);border:1px solid var(--border);border-radius:16px;
      padding:40px 32px;max-width:400px;width:100%;text-align:center;
    }
    .err-card img{max-width:140px;margin-bottom:20px}
    .err-card h1{font-size:1.2rem;margin-bottom:10px}
    .err-card p{color:var(--muted);font-size:.9rem}
  </style>
</head>
<body>
  <div class="err-card">
    <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
    <h1>Error temporal</h1>
    <p>${message}</p>
    <p style="margin-top:12px">Intenta de nuevo en unos segundos.</p>
  </div>
</body>
</html>`;
}
