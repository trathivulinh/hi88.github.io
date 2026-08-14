export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "*";
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        },
      });
    }
    const DEFAULTS = {
      live_enabled: true,
      show_live_on_home: true,
      live_url: "https://multidp.pages.dev/?cam=dgdakpuercam1",
      banners: [ {href:"#"}, {href:"#"}, {href:"#"}, {href:"#"}, {href:"#"} ],
      updated_at: new Date().toISOString()
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": origin, "Vary":"Origin" }
    });
    async function getConfig() {
      try { const raw = await env.LIVE_CONFIG.get("config"); return raw ? JSON.parse(raw) : DEFAULTS; }
      catch { return DEFAULTS; }
    }
    async function setConfig(cfg) {
      cfg.updated_at = new Date().toISOString();
      await env.LIVE_CONFIG.put("config", JSON.stringify(cfg));
      return cfg;
    }
    function isAuthorized() {
      const token = env.ADMIN_TOKEN || "CHANGE_ME_STRONG_TOKEN";
      const auth = req.headers.get("Authorization") || "";
      return auth.startsWith("Bearer ") && auth.slice(7) === token;
    }
    if (url.pathname === "/api/config") {
      if (req.method === "GET") return json(await getConfig());
      if (req.method === "POST") {
        if (!isAuthorized()) return json({ error: "Unauthorized" }, 401);
        const body = await req.json().catch(() => ({}));
        const cur = await getConfig();
        const next = {
          live_enabled: typeof body.live_enabled === "boolean" ? body.live_enabled : cur.live_enabled,
          show_live_on_home: typeof body.show_live_on_home === "boolean" ? body.show_live_on_home : cur.show_live_on_home,
          live_url: body.live_url ? String(body.live_url) : cur.live_url,
          banners: Array.isArray(body.banners) && body.banners.length
            ? body.banners.slice(0,5).map((b, i) => ({ href: (b && b.href) ? String(b.href) : (cur.banners[i]?.href || "#") }))
            : cur.banners,
          updated_at: new Date().toISOString()
        };
        return json(await setConfig(next));
      }
    }
    return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": origin } });
  }
};
