// Servidor do Fura-Fura (Cloudflare Worker) - pagamento PIX automático via Mercado Pago
// Variáveis a configurar no Cloudflare:
//   MP_ACCESS_TOKEN  (tipo Secret)  -> Access Token de PRODUÇÃO do Mercado Pago
//   ALLOWED_ORIGIN   (texto)        -> endereço do seu jogo, ex: https://seu-usuario.github.io
//   PAYER_EMAIL      (texto, opcional)
const J = (o, st, cors) =>
  new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": ok,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (ok !== "*" && origin && origin !== ok) return J({ erro: "origem não permitida" }, 403, cors);

    const url = new URL(req.url);
    const mp = (path, init = {}) =>
      fetch("https://api.mercadopago.com" + path, {
        ...init,
        headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN, "Content-Type": "application/json", ...(init.headers || {}) },
      });

    if (url.pathname === "/ping") return J({ ok: true, mp: !!env.MP_ACCESS_TOKEN }, 200, cors);
    if (!env.MP_ACCESS_TOKEN) return J({ erro: "token do Mercado Pago não configurado" }, 500, cors);

    // cria a cobrança PIX
    if (url.pathname === "/cobrar" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const valor = Math.round(Number(b.valor) * 100) / 100;
      const creditos = parseInt(b.creditos, 10);
      if (!(valor >= 0.01 && valor <= 5000) || !(creditos >= 1 && creditos <= 1000)) return J({ erro: "valor inválido" }, 400, cors);
      const pdv = String(b.pdv || "").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 30);
      const exp = Date.now() + 35 * 60000; // o Mercado Pago exige no mínimo 30 minutos
      const r = await mp("/v1/payments", {
        method: "POST",
        headers: { "X-Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          transaction_amount: valor,
          description: ("Fura-Fura " + pdv + " " + creditos + " creditos").replace(/\s+/g, " ").trim().slice(0, 100),
          payment_method_id: "pix",
          payer: { email: env.PAYER_EMAIL || "pagador@example.com" },
          external_reference: "ff-" + (pdv.replace(/ /g, "") || "pdv") + "-" + Date.now(),
          date_of_expiration: new Date(exp - 3 * 3600000).toISOString().replace("Z", "-03:00"),
        }),
      });
      const j = await r.json().catch(() => ({}));
      const td = (j.point_of_interaction && j.point_of_interaction.transaction_data) || {};
      if (!r.ok || !td.qr_code) return J({ erro: j.message || "erro no Mercado Pago (" + r.status + ")" }, 502, cors);
      return J({ id: j.id, qr_code: td.qr_code, qr_base64: td.qr_code_base64, exp }, 200, cors);
    }

    // consulta se a cobrança foi paga (só cobranças criadas por este servidor)
    if (url.pathname === "/status") {
      const id = url.searchParams.get("id") || "";
      if (!/^\d{5,20}$/.test(id)) return J({ erro: "id inválido" }, 400, cors);
      const r = await mp("/v1/payments/" + id);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !String(j.external_reference || "").startsWith("ff-")) return J({ erro: "não encontrado" }, 404, cors);
      return J({ id: j.id, status: j.status, valor: j.transaction_amount }, 200, cors);
    }
    return J({ erro: "rota não encontrada" }, 404, cors);
  },
};
