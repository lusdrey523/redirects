export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const code = path.slice(1).toUpperCase().trim();

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

// ——— Security helpers (mínimo viable) ———
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
  // Algunos clientes legítimos no envían Origin/Referer. En este caso
  // permitimos solo si es same-site implícito (navegación directa del panel).
  // Para un panel de un solo operador esto es aceptable.
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
      // Delay artificial en fallo para frenar fuerza bruta simple
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
`;
}
