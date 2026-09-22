export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const code = path.slice(1).toUpperCase().trim();

    // === API para Capa 2 ===
    if (path.startsWith("/api/")) {
      return handleApi(request, env, path, url);
    }

    if (path.startsWith("/admin")) {
      return handleAdmin(request, env, path, url);
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
        } catch (e) {}
        return Response.redirect(data.reviewUrl, 302);
      }

      return new Response(notConfiguredPage(code), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (err) {
      return new Response(errorPage(String(err.message || err)), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }
};


function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeText(str, maxLen = 120) {
  if (str == null) return "";
  return String(str).trim().slice(0, maxLen);
}

function isValidHttpsUrl(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (s.length < 12 || s.length > 500) return false;
  if (!/^https:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDeviceCode(code) {
  return typeof code === "string" && /^[A-Z0-9_-]{3,20}$/.test(code);
}

function sameOrigin(request, expectedOrigin) {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  if (origin) return origin === expectedOrigin;
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return true;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, max-age=0",
    ...extra
  };
}

async function handleAdmin(request, env, path, url) {
  const cookie = request.headers.get("Cookie") || "";
  const isLoggedIn = cookie.includes("breto_admin=1");
  const origin = url.origin;

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
          headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
        });
      }
      if (password === env.ADMIN_PASSWORD) {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": origin + "/admin/inicio",
            "Set-Cookie": "breto_admin=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400",
            ...securityHeaders()
          }
        });
      }
      await new Promise(r => setTimeout(r, 800));
      return new Response(loginPage(true), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
      });
    } catch (e) {
      return new Response(loginPage(true, "Error al procesar login"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
      });
    }
  }

  if (!isLoggedIn) {
    return new Response(loginPage(false), {
      headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
    });
  }

  if (path === "/admin") {
    return new Response(null, {
      status: 302,
      headers: { "Location": origin + "/admin/inicio" }
    });
  }

  if (path.startsWith("/admin/delete/") && request.method === "POST") {
    try {
      if (!sameOrigin(request, origin)) {
        return new Response("Forbidden", { status: 403, headers: securityHeaders() });
      }
      const deviceCode = path.replace("/admin/delete/", "").toUpperCase();
      if (!isValidDeviceCode(deviceCode)) {
        return new Response(errorPage("Código de dispositivo inválido"), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
        });
      }
      await env.DEVICES.delete(deviceCode);
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/dispositivos?msg=deleted", ...securityHeaders() }
      });
    } catch (e) {
      return new Response(errorPage("Error al eliminar"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
      });
    }
  }

  if (path === "/admin/new" && request.method === "POST") {
    try {
      if (!sameOrigin(request, origin)) {
        return new Response("Forbidden", { status: 403, headers: securityHeaders() });
      }
      const form = await request.formData();
      const newCode = (form.get("code") || "").toUpperCase().trim();
      if (!isValidDeviceCode(newCode)) {
        return new Response(errorPage("Código inválido. Use 3-20 caracteres: A-Z, 0-9, _ o -"), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
        });
      }
      const exists = await env.DEVICES.get(newCode);
      if (!exists) {
        await env.DEVICES.put(newCode, JSON.stringify({
          status: "pending",
          businessName: null,
          reviewUrl: null,
          scans: 0,
          createdAt: new Date().toISOString(),
          history: [{ action: "created", at: new Date().toISOString() }]
        }));
      }
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/edit/" + newCode + "?msg=created", ...securityHeaders() }
      });
    } catch (e) {
      return new Response(errorPage("Error al crear"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
      });
    }
  }

  if (path.startsWith("/admin/edit/") && request.method === "POST") {
    try {
      if (!sameOrigin(request, origin)) {
        return new Response("Forbidden", { status: 403, headers: securityHeaders() });
      }
      const deviceCode = path.replace("/admin/edit/", "").toUpperCase();
      if (!isValidDeviceCode(deviceCode)) {
        return new Response(errorPage("Código de dispositivo inválido"), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
        });
      }
      const form = await request.formData();
      const businessName = sanitizeText(form.get("businessName"), 120);
      const reviewUrlRaw = sanitizeText(form.get("reviewUrl"), 500);
      const validUrl = isValidHttpsUrl(reviewUrlRaw);

      const existingRaw = await env.DEVICES.get(deviceCode);
      let data = {};
      if (existingRaw) {
        try { data = JSON.parse(existingRaw); } catch (e) { data = {}; }
      }
      data.businessName = businessName || null;
      data.reviewUrl = validUrl ? reviewUrlRaw : (reviewUrlRaw || null);
      data.status = validUrl ? "configured" : "pending";
      data.updatedAt = new Date().toISOString();
      if (typeof data.scans !== "number") data.scans = 0;
      if (!Array.isArray(data.history)) data.history = [];
      data.history.push({
        action: validUrl ? "configured" : "updated",
        businessName,
        at: new Date().toISOString()
      });
      if (data.history.length > 20) data.history = data.history.slice(-20);
      await env.DEVICES.put(deviceCode, JSON.stringify(data));
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/dispositivos?msg=saved", ...securityHeaders() }
      });
    } catch (e) {
      return new Response(errorPage("Error al guardar"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() }
      });
    }
  }

  if (path.startsWith("/admin/edit/")) {
    const deviceCode = path.replace("/admin/edit/", "").toUpperCase();
    const raw = await env.DEVICES.get(deviceCode);
    let data = { businessName: "", reviewUrl: "", status: "pending", scans: 0, history: [] };
    if (raw) {
      try { data = { ...data, ...JSON.parse(raw) }; } catch (e) {}
    }
    const msg = url.searchParams.get("msg");
    return new Response(editFormPage(deviceCode, data, origin, msg), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (path === "/admin/new") {
    return new Response(newDevicePage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  if (path === "/admin/export") {
    try {
      const list = await env.DEVICES.list();
      let csv = "Codigo,Negocio,Estado,Escaneos,Ultimo uso,URL reseña,Creado\n";
      for (const key of list.keys) {
        const raw = await env.DEVICES.get(key.name);
        if (raw) {
          try {
            const d = JSON.parse(raw);
            csv += [
              key.name,
              '"' + (d.businessName || "").replace(/"/g, '""') + '"',
              d.status || "pending",
              d.scans || 0,
              d.lastUsed || "",
              '"' + (d.reviewUrl || "") + '"',
              d.createdAt || ""
            ].join(",") + "\n";
          } catch (e) {}
        }
      }
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=dispositivos-bretos.csv"
        }
      });
    } catch (e) {
      return new Response(errorPage("Error al exportar: " + e.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (path === "/admin/dispositivos") {
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
              businessName: data.businessName || "",
              status: data.status || "pending",
              scans: data.scans || 0,
              lastUsed: data.lastUsed || null,
              reviewUrl: data.reviewUrl || null
            });
          } catch (e) {
            devices.push({ code: key.name, businessName: "Error", status: "error", scans: 0, lastUsed: null });
          }
        }
      }
      devices.sort((a, b) => a.code.localeCompare(b.code));
      const filter = url.searchParams.get("filter") || "all";
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const msg = url.searchParams.get("msg");
      let filtered = devices;
      if (filter === "configured") filtered = filtered.filter(d => d.status === "configured");
      if (filter === "pending") filtered = filtered.filter(d => d.status !== "configured");
      if (q) {
        filtered = filtered.filter(d =>
          d.code.toLowerCase().includes(q) ||
          (d.businessName || "").toLowerCase().includes(q)
        );
      }
      return new Response(adminListPage(filtered, devices, filter, q, msg, origin), {
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
      return new Response(adminHomePage({ total, configured, pending, totalScans }, origin), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (e) {
      return new Response(adminHomePage({ total: 0, configured: 0, pending: 0, totalScans: 0 }, origin), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  if (path === "/admin/dominio") {
    return new Response(domainPage(origin), {
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
    headers: { "Location": origin + "/admin/inicio" }
  });
}

function siteFooter() {
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">Breto's Services</div>
      <div class="footer-tag">Tarjetas de reseñas Google · NFC + QR</div>
      <div class="footer-copy">© 2026 Breto's Services · Todos los derechos reservados</div>
    </div>
  </footer>`;
}

function sidebar(active = "inicio") {
  const items = [
    { id: "inicio", label: "Inicio", href: "/admin/inicio" },
    { id: "dispositivos", label: "Dispositivos", href: "/admin/dispositivos" },
    { id: "clientes", label: "Clientes", href: "/admin/clientes", soon: true },
    { id: "pedidos", label: "Pedidos", href: "/admin/pedidos", soon: true },
    { id: "packs", label: "Packs", href: "/admin/packs", soon: true },
    { id: "comprar", label: "Comprar", href: "/admin/comprar", soon: true },
    { id: "tarifas", label: "Tarifas", href: "/admin/tarifas", soon: true },
    { id: "contacto", label: "Contacto", href: "/admin/contacto", soon: true },
    { id: "dominio", label: "Dominio", href: "/admin/dominio" }
  ];
  return `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="brand">
        <img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
        <span class="brand-sub">Panel Admin</span>
      </div>
      <button class="hamburger" id="hamburger" aria-label="Menú" type="button"><span></span><span></span><span></span></button>
    </div>
    <div class="sidebar-body" id="sidebar-body">
      <nav class="nav">
        ${items.map(item => `
          <a href="${item.href}" class="nav-link ${active === item.id ? 'active' : ''} ${item.soon ? 'soon' : ''}">
            <span>${item.label}</span>
            ${item.soon ? '<em>Próx.</em>' : ''}
          </a>`).join('')}
      </nav>
      <a href="/admin/logout" class="logout">Cerrar sesión</a>
    </div>
  </aside>
  <script>
    (function(){
      var btn=document.getElementById('hamburger');
      var body=document.getElementById('sidebar-body');
      if(!btn||!body)return;
      btn.addEventListener('click',function(){body.classList.toggle('open');btn.classList.toggle('open');});
    })();
    function copyLink(text,btn){
      navigator.clipboard.writeText(text).then(function(){
        var o=btn.textContent;btn.textContent='Copiado';setTimeout(function(){btn.textContent=o;},1500);
      });
    }
  </script>`;
}

function baseStyles() {
  return `
  :root{--bg:#0b1220;--panel:#131c2e;--panel-2:#1a2538;--border:#243047;--text:#e8eef7;--muted:#8b9bb4;--accent:#3b9eff;--accent-soft:rgba(59,158,255,.12);--ok:#22c55e;--ok-bg:rgba(34,197,94,.12);--warn:#eab308;--warn-bg:rgba(234,179,8,.12);--danger:#ef4444;--danger-bg:rgba(239,68,68,.12);--radius:12px;--font:system-ui,-apple-system,sans-serif}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;display:flex;-webkit-font-smoothing:antialiased}
  .sidebar{width:220px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:50}
  .sidebar-header{padding:20px 14px 12px;border-bottom:1px solid var(--border)}
  .brand{text-align:center}.brand img{max-width:130px;display:block;margin:0 auto 6px}.brand-sub{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
  .hamburger{display:none;background:none;border:none;cursor:pointer;padding:8px;flex-direction:column;gap:5px}
  .hamburger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;transition:all .2s}
  .hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}.hamburger.open span:nth-child(2){opacity:0}.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
  .sidebar-body{flex:1;display:flex;flex-direction:column;padding:14px;overflow-y:auto}
  .nav{display:flex;flex-direction:column;gap:2px;flex:1}
  .nav-link{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:.9rem;transition:all .15s}
  .nav-link:hover{background:var(--panel-2);color:var(--text)}.nav-link.active{background:var(--accent-soft);color:var(--accent);font-weight:600}.nav-link.soon{opacity:.45;pointer-events:none}
  .nav-link em{font-style:normal;font-size:.65rem;background:var(--panel-2);padding:2px 6px;border-radius:6px;color:var(--muted)}
  .logout{display:block;text-align:center;margin-top:12px;padding:10px;border-radius:8px;background:var(--danger-bg);color:var(--danger);text-decoration:none;font-size:.85rem;font-weight:600;border:1px solid transparent}
  .logout:hover{border-color:var(--danger);background:rgba(239,68,68,.2)}
  .main{margin-left:220px;flex:1;padding:32px;min-height:100vh;display:flex;flex-direction:column}
  .main-content{flex:1}
  .page-header{margin-bottom:24px}.page-header h1{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}.page-header p{color:var(--muted);font-size:.9rem;margin-top:4px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:24px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px}
  .stat{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:18px 16px}
  .stat-label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}.stat-value{font-size:1.6rem;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:.875rem}th,td{padding:12px 10px;text-align:left;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:none}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600}.badge-ok{background:var(--ok-bg);color:var(--ok)}.badge-pending{background:var(--warn-bg);color:var(--warn)}
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:8px;font-size:.85rem;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .15s;font-family:inherit}
  .btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{filter:brightness(1.1)}.btn-ghost{background:var(--panel-2);color:var(--text)}.btn-ghost:hover{background:var(--border)}.btn-danger{background:var(--danger-bg);color:var(--danger)}.btn-danger:hover{background:rgba(239,68,68,.25)}.btn-sm{padding:5px 10px;font-size:.78rem}.btn-block{width:100%;padding:13px}
  .actions{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap}
  label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px;font-weight:500}
  input,textarea{width:100%;padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;font-family:inherit;margin-bottom:16px}
  input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}textarea{min-height:90px;resize:vertical}
  .hint{font-size:.78rem;color:var(--muted);margin-top:-10px;margin-bottom:16px}.code-tag{font-size:1.05rem;color:var(--accent);font-weight:700;letter-spacing:1px;margin-bottom:20px}
  .empty{text-align:center;padding:48px 20px;color:var(--muted)}.empty h2{font-size:1.2rem;color:var(--text);margin-bottom:8px}
  .alert{padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:.9rem;font-weight:500}.alert-ok{background:var(--ok-bg);color:var(--ok);border:1px solid rgba(34,197,94,.3)}.alert-info{background:var(--accent-soft);color:var(--accent);border:1px solid rgba(59,158,255,.3)}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
  .filter-btn{padding:6px 12px;border-radius:20px;font-size:.8rem;text-decoration:none;color:var(--muted);background:var(--panel-2);border:1px solid transparent}.filter-btn.active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent);font-weight:600}
  .search-box{flex:1;min-width:160px;margin:0}
  .qr-box{text-align:center;margin:20px 0;padding:16px;background:var(--bg);border-radius:10px;border:1px solid var(--border)}.qr-box img{width:160px;height:160px;border-radius:8px;background:#fff;padding:8px}
  .history{margin-top:24px;border-top:1px solid var(--border);padding-top:16px}.history h3{font-size:.9rem;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em}.history li{font-size:.8rem;color:var(--muted);padding:4px 0;list-style:none}
  .site-footer{margin-top:40px;padding:28px 16px 20px;border-top:1px solid var(--border);text-align:center}
  .footer-inner{max-width:520px;margin:0 auto}
  .footer-brand{font-weight:700;font-size:.95rem;margin-bottom:4px;color:var(--text)}
  .footer-tag{font-size:.8rem;color:var(--muted);margin-bottom:10px}
  .footer-copy{font-size:.72rem;color:var(--muted);opacity:.75}
  @media(max-width:768px){
    body{flex-direction:column}
    .sidebar{width:100%;height:auto;position:relative;border-right:none}
    .sidebar-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px}
    .brand{text-align:left;display:flex;align-items:center;gap:10px}.brand img{max-width:100px;margin:0}.brand-sub{display:none}.hamburger{display:flex}
    .sidebar-body{display:none;padding:8px 14px 16px;border-top:1px solid var(--border)}.sidebar-body.open{display:flex}
    .main{margin-left:0;padding:16px}.stats{grid-template-columns:1fr 1fr}
  }
  `;
}

function flashMsg(msg) {
  if (msg === "saved") return `<div class="alert alert-ok">Dispositivo guardado correctamente</div>`;
  if (msg === "created") return `<div class="alert alert-ok">Dispositivo creado. Configúralo ahora.</div>`;
  if (msg === "deleted") return `<div class="alert alert-info">Dispositivo eliminado</div>`;
  return "";
}

function loginPage(error = false, customMessage = null) {
  const errorMsg = customMessage || (error ? "Contraseña incorrecta" : null);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login – Breto's Services</title>
<style>${baseStyles()}body{align-items:center;justify-content:center;padding:24px;flex-direction:column}
.login-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:40px 32px;max-width:380px;width:100%;text-align:center}
.login-card img{max-width:180px;margin-bottom:8px}.login-card .sub{font-size:.8rem;color:var(--muted);margin-bottom:28px;text-transform:uppercase;letter-spacing:.06em}
.err{background:var(--danger-bg);color:var(--danger);padding:10px;border-radius:8px;margin-bottom:16px;font-size:.85rem}</style></head><body>
<div class="login-card"><img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services"><div class="sub">Panel de Administración</div>
${errorMsg ? `<div class="err">${errorMsg}</div>` : ''}
<form method="POST" action="/admin"><input type="password" name="password" placeholder="Contraseña" required autofocus>
<button type="submit" class="btn btn-primary btn-block">Entrar</button></form></div>
${siteFooter()}</body></html>`;
}

function adminHomePage(stats, origin) {
  const { total = 0, configured = 0, pending = 0, totalScans = 0 } = stats;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inicio – Breto's Services</title><style>${baseStyles()}</style></head><body>
${sidebar("inicio")}<main class="main"><div class="main-content">
<div class="page-header"><h1>Inicio</h1><p>Resumen de tu sistema de reseñas</p></div>
<div class="stats">
<div class="stat"><div class="stat-label">Dispositivos</div><div class="stat-value">${total}</div></div>
<div class="stat"><div class="stat-label">Configurados</div><div class="stat-value" style="color:var(--ok)">${configured}</div></div>
<div class="stat"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--warn)">${pending}</div></div>
<div class="stat"><div class="stat-label">Escaneos totales</div><div class="stat-value">${totalScans}</div></div>
</div>
<div class="card"><p style="color:var(--muted);line-height:1.6">Gestiona tus tarjetas NFC/QR de reseñas Google desde Dispositivos.</p>
<div class="actions" style="margin-top:18px">
<a href="/admin/dispositivos" class="btn btn-primary">Ir a Dispositivos</a>
<a href="/admin/new" class="btn btn-ghost">+ Nuevo dispositivo</a>
<a href="/admin/export" class="btn btn-ghost">Exportar CSV</a>
</div></div></div>${siteFooter()}</main></body></html>`;
}

function adminListPage(filtered, all, filter, q, msg, origin) {
  const counts = {
    all: all.length,
    configured: all.filter(d => d.status === "configured").length,
    pending: all.filter(d => d.status !== "configured").length
  };
  const rows = filtered.length === 0
    ? `<tr><td colspan="7"><div class="empty">No hay resultados</div></td></tr>`
    : filtered.map(d => {
        const shortUrl = origin + "/" + d.code;
        return `<tr>
<td><strong>${d.code}</strong></td><td>${d.businessName || "—"}</td>
<td><span class="badge ${d.status === 'configured' ? 'badge-ok' : 'badge-pending'}">${d.status === 'configured' ? 'Configurado' : 'Pendiente'}</span></td>
<td>${d.scans}</td><td>${d.lastUsed ? new Date(d.lastUsed).toLocaleString('es-CL') : '—'}</td>
<td><button type="button" class="btn btn-ghost btn-sm" onclick="copyLink('${shortUrl}', this)">Copiar enlace</button></td>
<td><a href="/admin/edit/${d.code}" class="btn btn-primary btn-sm">Configurar</a></td></tr>`;
      }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dispositivos – Breto's Services</title><style>${baseStyles()}</style></head><body>
${sidebar("dispositivos")}<main class="main"><div class="main-content">
<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
<div><h1>Dispositivos</h1><p>${filtered.length} de ${all.length}</p></div>
<div class="actions"><a href="/admin/new" class="btn btn-primary">+ Nuevo</a><a href="/admin/export" class="btn btn-ghost">Exportar CSV</a></div></div>
${flashMsg(msg)}
<div class="filters">
<a href="/admin/dispositivos?filter=all${q ? '&q=' + encodeURIComponent(q) : ''}" class="filter-btn ${filter === 'all' ? 'active' : ''}">Todos (${counts.all})</a>
<a href="/admin/dispositivos?filter=pending${q ? '&q=' + encodeURIComponent(q) : ''}" class="filter-btn ${filter === 'pending' ? 'active' : ''}">Pendientes (${counts.pending})</a>
<a href="/admin/dispositivos?filter=configured${q ? '&q=' + encodeURIComponent(q) : ''}" class="filter-btn ${filter === 'configured' ? 'active' : ''}">Configurados (${counts.configured})</a>
<form method="GET" action="/admin/dispositivos" style="display:flex;gap:8px;flex:1;min-width:180px">
<input type="hidden" name="filter" value="${filter}">
<input class="search-box" type="search" name="q" value="${q || ''}" placeholder="Buscar código o negocio…">
<button type="submit" class="btn btn-ghost btn-sm">Buscar</button></form></div>
<div class="card" style="overflow-x:auto"><table><thead><tr>
<th>Código</th><th>Negocio</th><th>Estado</th><th>Escaneos</th><th>Último uso</th><th>Enlace</th><th></th>
</tr></thead><tbody>${rows}</tbody></table></div></div>${siteFooter()}</main></body></html>`;
}

function editFormPage(code, data, origin, msg) {
  const shortUrl = origin + "/" + code;
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=" + encodeURIComponent(shortUrl);
  const history = Array.isArray(data.history) ? data.history.slice().reverse() : [];
  const safeName = escapeHtml(data.businessName || "");
  const safeUrl = escapeHtml(data.reviewUrl || "");
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Configurar ${escapeHtml(code)}</title><style>${baseStyles()}</style></head><body>
${sidebar("dispositivos")}<main class="main"><div class="main-content">
<div class="page-header"><h1>Configurar dispositivo</h1><p class="code-tag">${escapeHtml(code)}</p></div>
${flashMsg(msg)}
<div class="card" style="max-width:520px">
<form method="POST" action="/admin/edit/${encodeURIComponent(code)}">
<label>Nombre del negocio</label>
<input type="text" name="businessName" id="businessName" value="${safeName}" placeholder="Ej: Peluquería La Pelu" maxlength="120" required>
<div class="actions" style="margin-bottom:16px">
<button type="button" class="btn btn-ghost btn-sm" onclick="var n=document.getElementById('businessName').value.trim();if(n)window.open('https://www.google.com/maps/search/'+encodeURIComponent(n),'_blank');else alert('Escribe primero el nombre del negocio');">Buscar en Google Maps</button></div>
<label>Link de reseña de Google</label>
<textarea name="reviewUrl" maxlength="500" placeholder="https://search.google.com/local/writereview?placeid=...">${safeUrl}</textarea>
<p class="hint">1) Busca el negocio en Maps → 2) Copia el link de “Escribir una reseña” → 3) Pégalo aquí</p>
<div class="actions"><a href="/admin/dispositivos" class="btn btn-ghost" style="flex:1">Cancelar</a>
<button type="submit" class="btn btn-primary" style="flex:1">Guardar</button></div></form>
<div class="qr-box"><p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">QR del enlace corto</p>
<img src="${qrUrl}" alt="QR ${code}">
<p style="font-size:.8rem;margin-top:10px;word-break:break-all;color:var(--accent)">${shortUrl}</p>
<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="copyLink('${shortUrl}', this)">Copiar enlace</button></div>
<form method="POST" action="/admin/delete/${code}" onsubmit="return confirm('¿Eliminar ${code}? Esta acción no se puede deshacer.')">
<button type="submit" class="btn btn-danger btn-block">Eliminar dispositivo</button></form>
${history.length ? `<div class="history"><h3>Historial</h3><ul>${history.slice(0, 8).map(h => `<li>${h.action} · ${h.businessName || ''} · ${h.at ? new Date(h.at).toLocaleString('es-CL') : ''}</li>`).join('')}</ul></div>` : ''}
</div></div>${siteFooter()}</main></body></html>`;
}

function newDevicePage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuevo dispositivo – Breto's Services</title><style>${baseStyles()}</style></head><body>
${sidebar("dispositivos")}<main class="main"><div class="main-content">
<div class="page-header"><h1>Nuevo dispositivo</h1><p>Crea un código para una tarjeta NFC/QR</p></div>
<div class="card" style="max-width:440px">
<form method="POST" action="/admin/new">
<label>Código del dispositivo</label>
<input type="text" name="code" placeholder="Ej: BS011" required autofocus style="text-transform:uppercase">
<p class="hint">Formato recomendado: BS001, BS002…</p>
<button type="submit" class="btn btn-primary btn-block">Crear y configurar</button></form></div></div>${siteFooter()}</main></body></html>`;
}

function domainPage(origin) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dominio – Breto's Services</title><style>${baseStyles()}</style></head><body>
${sidebar("dominio")}<main class="main"><div class="main-content">
<div class="page-header"><h1>Dominio propio</h1><p>Configuración de dominio personalizado</p></div>
<div class="card" style="max-width:560px">
<p style="color:var(--muted);line-height:1.6;margin-bottom:16px">Actualmente usas: <strong style="color:var(--accent)">${origin}</strong></p>
<p style="color:var(--muted);line-height:1.6;margin-bottom:16px">Para usar un dominio propio (ej: <code>go.bretosservices.cl</code>):</p>
<ol style="color:var(--muted);line-height:1.8;padding-left:20px;margin-bottom:20px">
<li>Compra o usa un dominio que ya tengas</li>
<li>En Cloudflare Dashboard → Workers → redirects → Settings → Domains</li>
<li>Agrega el dominio / subdominio</li>
<li>Configura el registro DNS que te indique Cloudflare</li></ol>
<p style="color:var(--muted);font-size:.85rem">Esto no requiere cambios de código.</p></div></div>${siteFooter()}</main></body></html>`;
}

function placeholderPage(section) {
  const titles = { clientes: "Clientes", pedidos: "Pedidos", packs: "Packs", comprar: "Comprar", tarifas: "Tarifas", contacto: "Contacto" };
  const title = titles[section] || section;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} – Breto's Services</title><style>${baseStyles()}</style></head><body>
${sidebar(section)}<main class="main"><div class="main-content">
<div class="page-header"><h1>${title}</h1></div>
<div class="card empty"><h2>Próximamente</h2><p>Esta sección estará disponible en una próxima actualización.</p></div></div>${siteFooter()}</main></body></html>`;
}

function homePage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Breto's Services</title>
<style>${baseStyles()}body{align-items:center;justify-content:center;padding:24px;flex-direction:column}
.hero{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:48px 32px;max-width:400px;width:100%;text-align:center}
.hero img{max-width:240px;margin-bottom:16px}.hero p{color:var(--muted);font-size:.95rem;line-height:1.5}</style></head><body>
<div class="hero"><img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services"><p>Tarjetas de reseñas Google<br>NFC + QR</p></div>
${siteFooter()}</body></html>`;
}

function notConfiguredPage(code) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dispositivo pendiente – Breto's Services</title>
<style>${baseStyles()}body{align-items:center;justify-content:center;padding:24px;flex-direction:column}
.pending-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:40px 28px;max-width:400px;width:100%;text-align:center}
.pending-card img{max-width:160px;margin-bottom:24px}.pending-card h1{font-size:1.25rem;margin-bottom:10px;line-height:1.3}
.pending-card .sub{color:var(--muted);font-size:.9rem;line-height:1.5;margin-bottom:24px}
.code-box{font-size:1.6rem;font-weight:700;letter-spacing:3px;background:var(--bg);color:var(--accent);padding:12px 20px;border-radius:10px;display:inline-block;margin-bottom:24px;border:1px solid var(--border)}
.code-label{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.owner{font-size:.85rem;color:var(--muted);margin-bottom:14px}</style></head><body>
<div class="pending-card"><img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
<h1>Este dispositivo todavía no está configurado</h1>
<p class="sub">En cuanto su propietario lo configure, este enlace te llevará directamente a dejar una reseña en Google.</p>
<div class="code-label">Código del producto</div><div class="code-box">${code}</div>
<p class="owner">¿Eres el propietario de este dispositivo?</p>
<a href="/admin" class="btn btn-primary">Configúralo desde tu panel</a></div>
${siteFooter()}</body></html>`;
}

function errorPage(message = "Error temporal") {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error – Breto's Services</title>
<style>${baseStyles()}body{align-items:center;justify-content:center;padding:24px;flex-direction:column}
.err-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center}
.err-card img{max-width:140px;margin-bottom:20px}.err-card h1{font-size:1.2rem;margin-bottom:10px}.err-card p{color:var(--muted);font-size:.9rem}</style></head><body>
<div class="err-card"><img src="https://i.imgur.com/eHCpKk8.png" alt="Breto's Services">
<h1>Error temporal</h1><p>${message}</p><p style="margin-top:12px">Intenta de nuevo en unos segundos.</p></div>
${siteFooter()}</body></html>`;
}

// ===================== API Capa 2 =====================

async function handleApi(request, env, path, url) {
  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 1. Autenticación
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!env.API_TOKEN || token !== env.API_TOKEN) {
    return jsonResponse({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const method = request.method;

  // GET /api/stats
  if (path === "/api/stats" && method === "GET") {
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

      return jsonResponse({
        ok: true,
        data: { total, configured, pending, totalScans }
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message, code: "INTERNAL" }, 500);
    }
  }

  // GET /api/devices
  if (path === "/api/devices" && method === "GET") {
    try {
      const list = await env.DEVICES.list();
      const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 200);

      const devices = [];

      for (const key of list.keys) {
        const raw = await env.DEVICES.get(key.name);
        if (!raw) continue;

        try {
          const d = JSON.parse(raw);
          const item = {
            code: key.name,
            status: d.status || "pending",
            businessName: d.businessName || null,
            reviewUrl: d.reviewUrl || null,
            scans: Number(d.scans) || 0,
            lastUsed: d.lastUsed || null,
            createdAt: d.createdAt || null,
            updatedAt: d.updatedAt || null
          };

          if (statusFilter === "configured" && item.status !== "configured") continue;
          if (statusFilter === "pending" && item.status === "configured") continue;

          if (q) {
            const match = item.code.toLowerCase().includes(q) ||
                          (item.businessName || "").toLowerCase().includes(q);
            if (!match) continue;
          }

          devices.push(item);
        } catch (e) {}
      }

      devices.sort((a, b) => a.code.localeCompare(b.code));
      const sliced = devices.slice(0, limit);

      return jsonResponse({
        ok: true,
        data: sliced,
        meta: { total: devices.length, returned: sliced.length }
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message, code: "INTERNAL" }, 500);
    }
  }

  // GET /api/devices/:code
  if (path.startsWith("/api/devices/") && method === "GET") {
    const deviceCode = path.replace("/api/devices/", "").toUpperCase().trim();
    if (!isValidDeviceCode(deviceCode)) {
      return jsonResponse({ ok: false, error: "Código inválido", code: "INVALID_CODE" }, 400);
    }

    const raw = await env.DEVICES.get(deviceCode);
    if (!raw) {
      return jsonResponse({ ok: false, error: "Dispositivo no encontrado", code: "NOT_FOUND" }, 404);
    }

    try {
      const d = JSON.parse(raw);
      return jsonResponse({
        ok: true,
        data: {
          code: deviceCode,
          status: d.status || "pending",
          businessName: d.businessName || null,
          reviewUrl: d.reviewUrl || null,
          scans: Number(d.scans) || 0,
          lastUsed: d.lastUsed || null,
          createdAt: d.createdAt || null,
          updatedAt: d.updatedAt || null
        }
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: "Datos corruptos", code: "CORRUPT" }, 500);
    }
  }

  // POST /api/devices  (crear)
  if (path === "/api/devices" && method === "POST") {
    try {
      const body = await request.json();
      const newCode = (body.code || "").toUpperCase().trim();

      if (!isValidDeviceCode(newCode)) {
        return jsonResponse({
          ok: false,
          error: "Código inválido. Use 3-20 caracteres: A-Z, 0-9, _ o -",
          code: "INVALID_CODE"
        }, 400);
      }

      const exists = await env.DEVICES.get(newCode);
      if (exists) {
        return jsonResponse({ ok: false, error: "El código ya existe", code: "ALREADY_EXISTS" }, 409);
      }

      const data = {
        status: "pending",
        businessName: null,
        reviewUrl: null,
        scans: 0,
        createdAt: new Date().toISOString(),
        history: [{ action: "created", at: new Date().toISOString() }]
      };

      await env.DEVICES.put(newCode, JSON.stringify(data));

      return jsonResponse({
        ok: true,
        data: {
          code: newCode,
          status: "pending",
          businessName: null,
          reviewUrl: null,
          scans: 0,
          createdAt: data.createdAt
        }
      }, 201);
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message, code: "INTERNAL" }, 500);
    }
  }

  // PUT /api/devices/:code  (actualizar)
  if (path.startsWith("/api/devices/") && method === "PUT") {
    try {
      const deviceCode = path.replace("/api/devices/", "").toUpperCase().trim();
      if (!isValidDeviceCode(deviceCode)) {
        return jsonResponse({ ok: false, error: "Código inválido", code: "INVALID_CODE" }, 400);
      }

      const body = await request.json();
      const businessName = sanitizeText(body.businessName, 120);
      const reviewUrlRaw = sanitizeText(body.reviewUrl, 500);
      const validUrl = isValidHttpsUrl(reviewUrlRaw);

      const existingRaw = await env.DEVICES.get(deviceCode);
      let data = {};
      if (existingRaw) {
        try { data = JSON.parse(existingRaw); } catch (e) { data = {}; }
      } else {
        return jsonResponse({ ok: false, error: "Dispositivo no encontrado", code: "NOT_FOUND" }, 404);
      }

      data.businessName = businessName || null;
      data.reviewUrl = validUrl ? reviewUrlRaw : (reviewUrlRaw || null);
      data.status = validUrl ? "configured" : "pending";
      data.updatedAt = new Date().toISOString();
      if (typeof data.scans !== "number") data.scans = 0;
      if (!Array.isArray(data.history)) data.history = [];

      data.history.push({
        action: validUrl ? "configured" : "updated",
        businessName,
        at: new Date().toISOString()
      });
      if (data.history.length > 20) data.history = data.history.slice(-20);

      await env.DEVICES.put(deviceCode, JSON.stringify(data));

      return jsonResponse({
        ok: true,
        data: {
          code: deviceCode,
          status: data.status,
          businessName: data.businessName,
          reviewUrl: data.reviewUrl,
          scans: data.scans,
          lastUsed: data.lastUsed || null,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt
        }
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message, code: "INTERNAL" }, 500);
    }
  }

  // Cualquier otra ruta de API
  return jsonResponse({ ok: false, error: "Not Found", code: "NOT_FOUND" }, 404);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://panel-bretos-services.pages.dev",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}
