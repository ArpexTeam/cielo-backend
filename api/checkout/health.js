// api/checkout/health.js
const BASE = process.env.CIELO_BASE || "https://cieloecommerce.cielo.com.br";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

export default function handler(_req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.status(200).json({ ok: true, base: BASE });
}
