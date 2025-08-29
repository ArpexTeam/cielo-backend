// routes/checkout.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const MERCHANT_ID = process.env.CIELO_MERCHANT_ID;
const BASE = process.env.CIELO_BASE || "https://cieloecommerce.cielo.com.br";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// ---------------- utils ----------------
const toCents = (v) => {
  if (v == null) return 0;
  if (typeof v === "string") {
    const s = v.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 100 ? v : Math.round(v * 100);
  }
  return 0;
};

const ensureOrderNumber = (v) =>
  (typeof v === "string" && v.trim().length >= 1 ? v : "PED" + Date.now()).replace(/\s+/g, "");

const ensureSoftDescriptor = (v) =>
  (v || "Nomefantasia").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || "Nomefantasia";

// transforma itens vindos do front (nome, descricao, preco em reais etc.) em formato Cielo
function mapFrontItemsToCielo(items = []) {
  return items.map((p) => ({
    Name: p?.nome ?? p?.name ?? "Produto",
    Description: p?.descricao ?? p?.description ?? "Item",
    UnitPrice: toCents(p?.preco ?? p?.price ?? 0), // <- CENTAVOS!
    Quantity: Number(p?.quantidade ?? p?.quantity ?? 1) || 1,
    Type: p?.type ?? "Asset",
    Sku: String(p?.id ?? p?.sku ?? "SKU"),
    Weight: Number(p?.peso ?? p?.weight ?? 0),
  }));
}

// decide se o body já está no formato Cielo
function looksLikeCieloPayload(body) {
  return !!(body?.Cart?.Items && Array.isArray(body.Cart.Items) && body.Cart.Items[0]?.Name);
}

// --------------- CORS p/ esse router ---------------
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
router.options("/checkout", (_req, res) => res.sendStatus(200));
router.get("/checkout/health", (_req, res) => res.json({ ok: true, base: BASE }));

// --------------- endpoint principal ---------------
router.post("/checkout", async (req, res) => {
  try {
    if (!MERCHANT_ID) {
      return res.status(500).json({ error: "CIELO_MERCHANT_ID não configurado" });
    }

    // 1) Monta o payload no MESMO formato do teste.js
    let payload;
    if (looksLikeCieloPayload(req.body)) {
      // já veio em formato Cielo -> apenas saneia alguns campos
      const b = req.body;
      payload = {
        OrderNumber: ensureOrderNumber(b.OrderNumber),
        SoftDescriptor: ensureSoftDescriptor(b.SoftDescriptor),
        Cart: {
          Discount: {
            Type: b.Cart?.Discount?.Type ?? "Percent",
            Value: Number(b.Cart?.Discount?.Value ?? 0),
          },
          Items: b.Cart.Items.map((it) => ({
            Name: it.Name,
            Description: it.Description,
            UnitPrice: toCents(it.UnitPrice), // garante centavos
            Quantity: Number(it.Quantity || 1),
            Type: it.Type || "Asset",
            Sku: String(it.Sku || "SKU"),
            Weight: Number(it.Weight || 0),
          })),
        },
        Shipping: {
          Type: b.Shipping?.Type ?? "FixedAmount",
          Price: toCents(b.Shipping?.Price ?? 0),
          SourceZipCode: b.Shipping?.SourceZipCode,
          TargetZipCode: b.Shipping?.TargetZipCode,
          Services: b.Shipping?.Services,
          Address: b.Shipping?.Address,
        },
        Customer: b.Customer,
      };
    } else {
      // veio no formato "do front" (itens/valores em reais etc.)
      const { itens, items, shipping, customer, orderNumber, softDescriptor, cart } = req.body;
      const frontItems = cart?.items || items || itens || [];
      payload = {
        OrderNumber: ensureOrderNumber(orderNumber),
        SoftDescriptor: ensureSoftDescriptor(softDescriptor),
        Cart: {
          Discount: { Type: "Percent", Value: 0 },
          Items: mapFrontItemsToCielo(frontItems),
        },
        Shipping: {
          Type: (shipping && shipping.Type) || "FixedAmount",
          Price: toCents(shipping?.Price ?? 0),
          SourceZipCode: shipping?.SourceZipCode,
          TargetZipCode: shipping?.TargetZipCode,
          Services: shipping?.Services,
          Address: shipping?.Address,
        },
        Customer: customer || undefined,
      };
    }

    // validação mínima: nenhum UnitPrice pode ser 0
    if (payload.Cart.Items.some((it) => !it.UnitPrice || it.UnitPrice < 1)) {
      return res.status(400).json({ error: "UnitPrice inválido (deve estar em centavos e >= 1)." });
    }

    // 2) Envia para a Cielo — mesma configuração do teste.js
    const response = await axios.request({
      method: "POST",
      url: `${BASE}/api/public/v1/orders`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        MerchantId: MERCHANT_ID,
      },
      data: payload,
      timeout: 20000,
      validateStatus: () => true,
      responseType: "text",
    });

    // 3) Normaliza resposta (texto -> json) e devolve
    let body = response.data;
    if (typeof body === "string" && body.length) {
      try { body = JSON.parse(body); } catch { /* mantém texto */ }
    }

    // sucesso: 200/201 – retorna como JSON
    if (response.status === 200 || response.status === 201) {
      return typeof body === "string"
        ? res.status(response.status).type("application/json").send(body)
        : res.status(response.status).json(body);
    }

    // erro da Cielo – repassa mensagem legível
    return res.status(response.status).json(
      typeof body === "object" ? body : { error: "Cielo error", raw: body }
    );

  } catch (err) {
    const status = err?.response?.status;
    const raw = err?.response?.data;
    let body = raw;
    if (typeof raw === "string") { try { body = JSON.parse(raw); } catch {} }

    console.error("Erro /api/checkout:", status || "", body || err.message);
    return res.status(500).json({
      error: "Proxy error",
      status,
      body: body || err.message,
    });
  }
});

export default router;
