// api/checkout.js
import axios from "axios";

const MERCHANT_ID      = process.env.CIELO_MERCHANT_ID;
const BASE             = process.env.CIELO_BASE || "https://cieloecommerce.cielo.com.br";
const ALLOWED_ORIGIN   = process.env.ALLOWED_ORIGIN || "*";
// NOVO: URLs
const NOTIFICATION_URL = process.env.CIELO_NOTIFICATION_URL; // ex.: https://seu-backend.vercel.app/api/cielo-webhook
const RETURN_URL_BASE  = process.env.RETURN_URL_BASE;        // ex.: https://seu-front.vercel.app

// ... (utils inalterados)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).send("Method not allowed");

  try {
    if (!MERCHANT_ID) {
      return res.status(500).json({ error: "CIELO_MERCHANT_ID não configurado" });
    }
    if (!NOTIFICATION_URL || !RETURN_URL_BASE) {
      return res.status(500).json({ error: "CIELO_NOTIFICATION_URL/RETURN_URL_BASE não configurados" });
    }

    let payload;
    if (looksLikeCieloPayload(req.body)) {
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
            UnitPrice: toCents(it.UnitPrice),
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
        // NOVO:
        Settings: {
          NotificationUrl: NOTIFICATION_URL, // a Cielo envia POST aqui
          ReturnUrl: `${RETURN_URL_BASE}/checkout/retorno?order=${encodeURIComponent(ensureOrderNumber(b.OrderNumber))}`,
        },
      };
    } else {
      const { itens, items, shipping, customer, orderNumber, softDescriptor, cart } = req.body;
      const frontItems = cart?.items || items || itens || [];
      const ord = ensureOrderNumber(orderNumber);
      payload = {
        OrderNumber: ord,
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
        // NOVO:
        Settings: {
          NotificationUrl: NOTIFICATION_URL,
          ReturnUrl: `${RETURN_URL_BASE}/checkout/retorno?order=${encodeURIComponent(ord)}`,
        },
      };
    }

    if (payload.Cart.Items.some((it) => !it.UnitPrice || it.UnitPrice < 1)) {
      return res.status(400).json({ error: "UnitPrice inválido (centavos >= 1)." });
    }

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

    let body = response.data;
    if (typeof body === "string" && body.length) {
      try { body = JSON.parse(body); } catch {}
    }
    if (response.status === 200 || response.status === 201) {
      return typeof body === "string"
        ? res.status(response.status).type("application/json").send(body)
        : res.status(response.status).json(body);
    }
    return res.status(response.status).json(
      typeof body === "object" ? body : { error: "Cielo error", raw: body }
    );
  } catch (err) {
    const status = err?.response?.status;
    const raw = err?.response?.data;
    let body = raw;
    if (typeof raw === "string") { try { body = JSON.parse(raw); } catch {} }
    console.error("Erro /api/checkout:", status || "", body || err.message);
    return res.status(500).json({ error: "Proxy error", status, body: body || err.message });
  }
}
