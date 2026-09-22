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
