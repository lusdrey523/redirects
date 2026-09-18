export default {
  async fetch(request, env) {
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
      const raw = await env.DEVICES.get(code);
      if (!raw) {
        return new Response(notConfiguredPage(code), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      const data = JSON.parse(raw);

      if (data.status === "configured" && data.reviewUrl) {
        data.scans = (data.scans || 0) + 1;
        data.lastUsed = new Date().toISOString();
        env.DEVICES.put(code, JSON.stringify(data)).catch(() => {});
        return Response.redirect(data.reviewUrl, 302);
      }

      return new Response(notConfiguredPage(code), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (err) {
      return new Response(errorPage(), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }
};

async function handleAdmin(request, env, path) {
  const cookie = request.headers.get("Cookie") || "";
  const isLoggedIn = cookie.includes("breto_admin=1");

  if (path === "/admin/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/admin",
        "Set-Cookie": "breto_admin=; Path=/; Max-Age=0"
      }
    });
  }

  if (path === "/admin" && request.method === "POST") {
    const form = await request.formData();
    const password = form.get("password");
    if (password === env.ADMIN_PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/admin",
          "Set-Cookie": "breto_admin=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400"
        }
      });
    }
    return new Response(loginPage(true), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (!isLoggedIn) {
    return new Response(loginPage(false), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Crear nuevo dispositivo
  if (path === "/admin/new" && request.method === "POST") {
    const form = await request.formData();
    const newCode = (form.get("code") || "").toUpperCase().trim();
    if (!newCode) return Response.redirect("/admin", 302);

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
    return Response.redirect("/admin/edit/" + newCode, 302);
  }

  // Guardar configuración
  if (path.startsWith("/admin/edit/") && request.method === "POST") {
    const deviceCode = path.replace("/admin/edit/", "").toUpperCase();
    const form = await request.formData();
    const businessName = (form.get("businessName") || "").trim();
    const reviewUrl = (form.get("reviewUrl") || "").trim();

    const existingRaw = await env.DEVICES.get(deviceCode);
    let data = existingRaw ? JSON.parse(existingRaw) : {};

    data.businessName = businessName || null;
    data.reviewUrl = reviewUrl || null;
    data.status = reviewUrl ? "configured" : "pending";
    data.updatedAt = new Date().toISOString();
    if (!data.scans) data.scans = 0;

    await env.DEVICES.put(deviceCode, JSON.stringify(data));
    return Response.redirect("/admin", 302);
  }

  // Formulario de edición
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

  // Página para crear nuevo
  if (path === "/admin/new") {
    return new Response(newDevicePage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Lista
  if (path === "/admin") {
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
  }

  return Response.redirect("/admin", 302);
}

function loginPage(error = false) {
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
    ${error ? '<div class="error">Contraseña incorrecta</div>' : ''}
    <form method="POST" action="/admin">
      <input type="password" name="password" placeholder="Contraseña" required autofocus>
      <button type="submit">Entrar</button>
    </form>
  </div>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;max-width:1000px;margin-left:auto;margin-right:auto}
    .logo{max-width:140px}
    .logout{color:#94a3b8;text-decoration:none;font-size:.9rem}
    .card{background:#1e293b;border-radius:16px;padding:24px;max-width:1000px;margin:0 auto;overflow-x:auto}
    h1{font-size:1.3rem;margin-bottom:16px}
    .top-actions{margin-bottom:20px}
    .btn-new{display:inline-block;padding:10px 18px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600;font-size:.9rem}
    table{width:100%;border-collapse:collapse;font-size:.9rem}
    th,td{padding:12px 10px;text-align:left;border-bottom:1px solid #334155}
    th{color:#94a3b8;font-weight:600;font-size:.8rem;text-transform:uppercase}
    .badge{display:inline-block;padding:4px 10px;border-radius:12px;font-size:.75rem;font-weight:600}
    .badge.ok{background:#065f46;color:#6ee7b7}
    .badge.pending{background:#713f12;color:#fcd34d}
    .btn{display:inline-block;padding:6px 12px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:8px;font-size:.8rem;font-weight:600}
  </style>
</head>
<body>
  <div class="header">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <a href="/admin/logout" class="logout">Cerrar sesión</a>
  </div>
  <div class="card">
    <h1>Dispositivos</h1>
    <div class="top-actions">
      <a href="/admin/new" class="btn-new">+ Nuevo dispositivo</a>
    </div>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;max-width:480px;margin-left:auto;margin-right:auto}
    .logo{max-width:130px}
    .back{color:#94a3b8;text-decoration:none;font-size:.9rem}
    .card{background:#1e293b;border-radius:16px;padding:32px;max-width:480px;margin:0 auto}
    h1{font-size:1.3rem;margin-bottom:24px}
    label{display:block;font-size:.9rem;color:#94a3b8;margin-bottom:6px}
    input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:1rem;margin-bottom:20px}
    input:focus{outline:none;border-color:#38bdf8}
    button{width:100%;padding:14px;border:none;border-radius:10px;background:#38bdf8;color:#0f172a;font-size:1rem;font-weight:600;cursor:pointer}
    .hint{font-size:.8rem;color:#64748b;margin-top:-12px;margin-bottom:20px}
  </style>
</head>
<body>
  <div class="header">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <a href="/admin" class="back">← Volver</a>
  </div>
  <div class="card">
    <h1>Nuevo dispositivo</h1>
    <form method="POST" action="/admin/new">
      <label>Código del dispositivo</label>
      <input type="text" name="code" placeholder="Ej: BS011" required autofocus style="text-transform:uppercase">
      <p class="hint">Usa el formato BS001, BS002, etc.</p>
      <button type="submit">Crear y configurar</button>
    </form>
  </div>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;max-width:520px;margin-left:auto;margin-right:auto}
    .logo{max-width:130px}
    .back{color:#94a3b8;text-decoration:none;font-size:.9rem}
    .card{background:#1e293b;border-radius:16px;padding:32px;max-width:520px;margin:0 auto}
    h1{font-size:1.3rem;margin-bottom:6px}
    .code{font-size:1.1rem;color:#38bdf8;font-weight:700;letter-spacing:1px;margin-bottom:24px}
    label{display:block;font-size:.9rem;color:#94a3b8;margin-bottom:6px}
    input,textarea{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:1rem;margin-bottom:18px}
    input:focus,textarea:focus{outline:none;border-color:#38bdf8}
    textarea{min-height:90px;resize:vertical}
    .hint{font-size:.8rem;color:#64748b;margin-top:-12px;margin-bottom:20px}
    .actions{display:flex;gap:12px}
    button,.btn-cancel{flex:1;padding:14px;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
    button{background:#38bdf8;color:#0f172a}
    .btn-cancel{background:#334155;color:#f8fafc;display:flex;align-items:center;justify-content:center}
  </style>
</head>
<body>
  <div class="header">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <a href="/admin" class="back">← Volver</a>
  </div>
  <div class="card">
    <h1>Configurar dispositivo</h1>
    <div class="code">${code}</div>
    <form method="POST" action="/admin/edit/${code}">
      <label>Nombre del negocio</label>
      <input type="text" name="businessName" value="${data.businessName || ''}" placeholder="Ej: Peluquería La Pelu" required>
      <label>Link de reseña de Google</label>
      <textarea name="reviewUrl" placeholder="https://search.google.com/local/writereview?placeid=...">${data.reviewUrl || ''}</textarea>
      <p class="hint">Pega el link completo de "Escribir una reseña"</p>
      <div class="actions">
        <a href="/admin" class="btn-cancel">Cancelar</a>
        <button type="submit">Guardar</button>
      </div>
    </form>
  </div>
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
  <title>Dispositivo pendiente</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .logo{max-width:200px;width:100%;margin-bottom:28px}
    h1{font-size:1.35rem;margin-bottom:16px}
    .code{font-size:1.75rem;font-weight:700;letter-spacing:3px;background:#0f172a;color:#38bdf8;padding:14px 24px;border-radius:10px;display:inline-block;margin:8px 0 20px}
    p{color:#94a3b8;font-size:.95rem;line-height:1.5}
    .footer{margin-top:28px;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <h1>Dispositivo pendiente</h1>
    <div class="code">${code}</div>
    <p>Este dispositivo aún no ha sido configurado.</p>
    <p class="footer">Contacta a Breto's Services para activarlo</p>
  </div>
</body>
</html>`;
}

function errorPage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center}
    .logo{max-width:180px;width:100%;margin-bottom:24px}
    h1{font-size:1.35rem;margin-bottom:12px}
    p{color:#94a3b8}
  </style>
</head>
<body>
  <div class="card">
    <img src="https://i.imgur.com/eHCpKk8.png" class="logo">
    <h1>Error temporal</h1>
    <p>Intenta de nuevo en unos segundos.</p>
  </div>
</body>
</html>`;
}
