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
            "Location": origin + "/admin",
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
    return new Response(adminHomePage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
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

function sidebar(active = "dispositivos") {
  const items = [
    { id: "inicio", label: "Inicio", href: "/admin/inicio", icon: "⌂" },
    { id: "dispositivos", label: "Dispositivos", href: "/admin/dispositivos", icon: "▦" },
    { id: "clientes", label: "Clientes", href: "/admin/clientes", icon: "☺", soon: true },
    { id: "pedidos", label: "Pedidos", href: "/admin/pedidos", icon: "☰", soon: true },
    { id: "packs", label: "Packs", href: "/admin/packs", icon: "▣", soon: true },
    { id: "comprar", label: "Comprar", href: "/admin/comprar", icon: "₱", soon: true },
    { id: "tarifas", label: "Tarifas", href: "/admin/tarifas", icon: "₱", soon: true },
    { id: "contacto", label: "Contacto", href: "/admin/contacto", icon: "✉", soon: true }
  ];

  return `
  <aside class="sidebar">
    <div class="sidebar-brand">
      <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
    </div>
    <nav class="sidebar-nav">
      ${items.map(item => `
        <a href="${item.href}" class="nav-item ${active === item.id ? 'active' : ''} ${item.soon ? 'soon' : ''}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
          ${item.soon ? '<span class="badge-soon">Próximamente</span>' : ''}
        </a>
      `).join('')}
    </nav>
    <div class="sidebar-footer">
      <a href="/admin/logout" class="logout-btn">⏻ Cerrar sesión</a>
    </div>
  </aside>`;
}

function layoutStyles() {
  return `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex}
    .sidebar{width:240px;background:#1e293b;display:flex;flex-direction:column;border-right:1px solid #334155;position:fixed;top:0;left:0;height:100vh;overflow-y:auto;z-index:100}
    .sidebar-brand{padding:20px;text-align:center;border-bottom:1px solid #334155;flex-shrink:0}
    .sidebar-brand img{max-width:140px}
    .sidebar-nav{flex:1;padding:16px 12px;overflow-y:auto}
    .nav-item{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;color:#94a3b8;text-decoration:none;font-size:.95rem;margin-bottom:4px;transition:all .15s}
    .nav-item:hover{background:#334155;color:#f8fafc}
    .nav-item.active{background:#0f172a;color:#38bdf8;font-weight:600}
    .nav-item.soon{opacity:.55;pointer-events:none}
    .nav-icon{font-size:1.1rem;width:22px;text-align:center}
    .badge-soon{margin-left:auto;font-size:.65rem;background:#334155;color:#94a3b8;padding:2px 7px;border-radius:8px}
    .sidebar-footer{padding:16px;border-top:1px solid #334155;flex-shrink:0;background:#1e293b}
    .logout-btn{
      display:block;
      text-align:center;
      color:#f87171;
      text-decoration:none;
      font-size:.95rem;
      font-weight:600;
      padding:12px 14px;
      border-radius:10px;
      border:1px solid #7f1d1d;
      background:#450a0a;
      transition:all .15s;
    }
    .logout-btn:hover{background:#7f1d1d;color:#fecaca;border-color:#f87171}
    .main{margin-left:240px;flex:1;padding:28px;min-height:100vh}
    .card{background:#1e293b;border-radius:16px;padding:24px;overflow-x:auto}
    h1{font-size:1.4rem;margin-bottom:20px}
    @media(max-width:768px){
      .sidebar{width:100%;height:auto;position:relative;border-right:none}
      body{flex-direction:column}
      .main{margin-left:0;padding:16px}
      .sidebar-nav{display:flex;flex-wrap:wrap;gap:4px;padding:12px}
      .nav-item{flex:1 1 45%;justify-content:center;font-size:.85rem}
      .badge-soon{display:none}
      .sidebar-footer{border-top:1px solid #334155}
    }
  `;
}

function loginPage(error = false, customMessage = null) {
  const errorMsg = customMessage || (error ? "Contraseña incorrecta" : null);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login – Breto's Services</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .logo{max-width:200px;width:100%;margin-bottom:28px}
    h1{font-size:1.3rem;margin-bottom:24px}
    input{width:100%;padding:14px 16px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:1rem;margin-bottom:16px}
    input:focus{outline:none;border-color:#38bdf8}
    button{width:100%;padding:14px;border:none;border-radius:10px;background:#38bdf8;color:#0f172a;font-size:1rem;font-weight:600;cursor:pointer}
    .error{background:#7f1d1d;color:#fecaca;padding:10px;border-radius:8px;margin-bottom:16px;font-size:.9rem}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services" class="logo">
    <h1>Panel de Administración</h1>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Contraseña" required autofocus>
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

function adminHomePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inicio – Breto's Services</title>
  <style>${layoutStyles()}</style>
</head>
<body>
  ${sidebar("inicio")}
  <main class="main">
    <div class="card">
      <h1>Inicio</h1>
      <p style="color:#94a3b8;line-height:1.6">Bienvenido al panel de Breto's Services.</p>
      <p style="color:#94a3b8;margin-top:12px;line-height:1.6">Desde aquí puedes gestionar tus dispositivos NFC/QR de reseñas Google.</p>
      <a href="/admin/dispositivos" style="display:inline-block;margin-top:24px;padding:12px 20px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600">Ir a Dispositivos</a>
    </div>
  </main>
</body>
</html>`;
}

function adminListPage(devices) {
  const rows = devices.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8">No hay dispositivos todavía</td></tr>`
    : devices.map(d => `
      <tr>
        <td><strong>${d.code}</strong></td>
        <td>${d.businessName}</td>
        <td><span class="badge ${d.status === 'configured' ? 'ok' : 'pending'}">${d.status === 'configured' ? 'Configurado' : 'Pendiente'}</span></td>
        <td>${d.scans}</td>
        <td>${d.lastUsed ? new Date(d.lastUsed).toLocaleString('es-CL') : '—'}</td>
        <td><a href="/admin/edit/${d.code}" class="btn">Configurar</a></td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dispositivos – Breto's Services</title>
  <style>
    ${layoutStyles()}
    table{width:100%;border-collapse:collapse;font-size:.9rem}
    th,td{padding:12px 10px;text-align:left;border-bottom:1px solid #334155}
    th{color:#94a3b8;font-weight:600;font-size:.8rem;text-transform:uppercase}
    .badge{display:inline-block;padding:4px 10px;border-radius:12px;font-size:.75rem;font-weight:600}
    .badge.ok{background:#065f46;color:#6ee7b7}
    .badge.pending{background:#713f12;color:#fcd34d}
    .btn{display:inline-block;padding:6px 12px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:8px;font-size:.8rem;font-weight:600}
    .btn-new{display:inline-block;padding:10px 18px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600;font-size:.9rem;margin-bottom:20px}
  </style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="card">
      <h1>Dispositivos</h1>
      <a href="/admin/new" class="btn-new">+ Nuevo dispositivo</a>
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
    clientes: "Clientes",
    pedidos: "Pedidos",
    packs: "Packs",
    comprar: "Comprar",
    tarifas: "Tarifas",
    contacto: "Contacto"
  };
  const title = titles[section] || section;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} – Breto's Services</title>
  <style>${layoutStyles()}</style>
</head>
<body>
  ${sidebar(section)}
  <main class="main">
    <div class="card" style="text-align:center;padding:60px 24px">
      <h1>${title}</h1>
      <p style="color:#94a3b8;margin-top:12px;font-size:1.05rem">Próximamente</p>
      <p style="color:#64748b;margin-top:8px;font-size:.9rem">Esta sección estará disponible en una próxima actualización.</p>
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
  <style>
    ${layoutStyles()}
    label{display:block;font-size:.9rem;color:#94a3b8;margin-bottom:6px}
    input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:1rem;margin-bottom:20px}
    input:focus{outline:none;border-color:#38bdf8}
    button{width:100%;padding:14px;border:none;border-radius:10px;background:#38bdf8;color:#0f172a;font-size:1rem;font-weight:600;cursor:pointer}
    .hint{font-size:.8rem;color:#64748b;margin-top:-12px;margin-bottom:20px}
  </style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="card" style="max-width:480px">
      <h1>Nuevo dispositivo</h1>
      <form method="POST" action="/admin/new">
        <label>Código del dispositivo</label>
        <input type="text" name="code" placeholder="Ej: BS011" required autofocus style="text-transform:uppercase">
        <p class="hint">Usa el formato BS001, BS002, etc.</p>
        <button type="submit">Crear y configurar</button>
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
  <style>
    ${layoutStyles()}
    label{display:block;font-size:.9rem;color:#94a3b8;margin-bottom:6px}
    input,textarea{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:1rem;margin-bottom:18px}
    input:focus,textarea:focus{outline:none;border-color:#38bdf8}
    textarea{min-height:90px;resize:vertical}
    .hint{font-size:.8rem;color:#64748b;margin-top:-12px;margin-bottom:20px}
    .code{font-size:1.1rem;color:#38bdf8;font-weight:700;letter-spacing:1px;margin-bottom:24px}
    .actions{display:flex;gap:12px}
    button,.btn-cancel{flex:1;padding:14px;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
    button{background:#38bdf8;color:#0f172a}
    .btn-cancel{background:#334155;color:#f8fafc;display:flex;align-items:center;justify-content:center}
  </style>
</head>
<body>
  ${sidebar("dispositivos")}
  <main class="main">
    <div class="card" style="max-width:520px">
      <h1>Configurar dispositivo</h1>
      <div class="code">${code}</div>
      <form method="POST" action="/admin/edit/${code}">
        <label>Nombre del negocio</label>
        <input type="text" name="businessName" value="${data.businessName || ''}" placeholder="Ej: Peluquería La Pelu" required>
        <label>Link de reseña de Google</label>
        <textarea name="reviewUrl" placeholder="https://search.google.com/local/writereview?placeid=...">${data.reviewUrl || ''}</textarea>
        <p class="hint">Pega el link completo de "Escribir una reseña"</p>
        <div class="actions">
          <a href="/admin/dispositivos" class="btn-cancel">Cancelar</a>
          <button type="submit">Guardar</button>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:48px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .logo{max-width:260px;width:100%;margin-bottom:20px}
    .tagline{font-size:1rem;color:#94a3b8;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <p class="tagline">Tarjetas de reseñas Google<br>NFC + QR</p>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:40px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .logo{max-width:180px;width:100%;margin-bottom:28px}
    h1{font-size:1.4rem;font-weight:700;margin-bottom:12px;line-height:1.3}
    .subtitle{color:#94a3b8;font-size:.95rem;line-height:1.5;margin-bottom:28px}
    .code-label{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .code{font-size:1.8rem;font-weight:700;letter-spacing:3px;background:#0f172a;color:#38bdf8;padding:14px 24px;border-radius:10px;display:inline-block;margin-bottom:28px}
    .owner-text{font-size:.9rem;color:#94a3b8;margin-bottom:16px}
    .btn{display:inline-block;padding:14px 28px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600;font-size:1rem}
    .footer{margin-top:32px;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo" alt="Breto's Services">
    <h1>Este dispositivo todavía no está configurado</h1>
    <p class="subtitle">En cuanto su propietario lo configure, este enlace te llevará directamente a dejar una reseña en Google.</p>
    <div class="code-label">Código del producto</div>
    <div class="code">${code}</div>
    <p class="owner-text">¿Eres el propietario de este dispositivo?</p>
    <a href="/admin" class="btn">Configúralo desde tu panel</a>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center}
    .logo{max-width:180px;width:100%;margin-bottom:24px}
    h1{font-size:1.35rem;margin-bottom:12px}
    p{color:#94a3b8;font-size:.9rem}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <h1>Error temporal</h1>
    <p>${message}</p>
    <p style="margin-top:16px">Intenta de nuevo en unos segundos.</p>
  </div>
</body>
</html>`;
}
