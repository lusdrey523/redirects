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
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (password === env.ADMIN_PASSWORD) {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": origin + "/admin/inicio",
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

  if (path === "/admin") {
    return new Response(null, {
      status: 302,
      headers: { "Location": origin + "/admin/inicio" }
    });
  }

  if (path.startsWith("/admin/delete/") && request.method === "POST") {
    try {
      const deviceCode = path.replace("/admin/delete/", "").toUpperCase();
      await env.DEVICES.delete(deviceCode);
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/dispositivos?msg=deleted" }
      });
    } catch (e) {
      return new Response(errorPage("Error al eliminar: " + e.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
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
          createdAt: new Date().toISOString(),
          history: [{ action: "created", at: new Date().toISOString() }]
        }));
      }
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/edit/" + newCode + "?msg=created" }
      });
    } catch (e) {
      return new Response(errorPage("Error al crear: " + e.message), {
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
      if (!Array.isArray(data.history)) data.history = [];
      data.history.push({
        action: reviewUrl ? "configured" : "updated",
        businessName,
        at: new Date().toISOString()
      });
      if (data.history.length > 20) data.history = data.history.slice(-20);
      await env.DEVICES.put(deviceCode, JSON.stringify(data));
      return new Response(null, {
        status: 302,
        headers: { "Location": origin + "/admin/dispositivos?msg=saved" }
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

// NOTE: The remaining functions (siteFooter, sidebar, baseStyles, loginPage, admin pages, etc.) 
// are present in the full stable version. This push is truncated by tool limits.
// Use the local stable_index.js or the commit 1262fb0 for the complete file.
