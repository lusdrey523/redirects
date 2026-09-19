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

  // The rest of the original file is truncated in this restore attempt. 
  // Full restore will be done in next step.
  return new Response("Panel temporarily under maintenance - restoring", { status: 503 });
}
