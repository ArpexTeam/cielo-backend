// api/qz/sign.js
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PRIV_FILE_FALLBACK = path.join(process.cwd(), "api", "certs", "qz-private.pem");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Carrega a chave privada a partir de:
// 1) QZ_PRIVATE_KEY_B64 (Base64 do PEM)   OU
// 2) QZ_PRIVATE_KEY (texto PEM com \n escapados)  OU
// 3) Arquivo em api/certs/qz-private.pem (fallback DEV)
let PRIVATE_KEY_CACHE = null;
function getPrivateKey() {
  if (PRIVATE_KEY_CACHE) return PRIVATE_KEY_CACHE;

  const b64 = process.env.QZ_PRIVATE_KEY_B64;
  const raw = process.env.QZ_PRIVATE_KEY;

  if (b64) {
    PRIVATE_KEY_CACHE = Buffer.from(b64, "base64").toString("utf8");
    return PRIVATE_KEY_CACHE;
  }
  if (raw) {
    // Se veio com "\n" textuais do painel de env, converte
    PRIVATE_KEY_CACHE = raw.replace(/\\n/g, "\n");
    return PRIVATE_KEY_CACHE;
  }
  // Fallback DEV: lê do arquivo do repo (não recomendado em PROD)
  PRIVATE_KEY_CACHE = fs.readFileSync(PRIV_FILE_FALLBACK, "utf8");
  return PRIVATE_KEY_CACHE;
}

export default function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  try {
    const { request } = req.body || {};
    if (typeof request !== "string" || !request.length) {
      return res.status(400).json({ error: "bad-request", details: "`request` inválido" });
    }

    const key = getPrivateKey();
    const signer = crypto.createSign("sha256");
    signer.update(request);
    signer.end();
    const signature = signer.sign(key, "base64"); // QZ espera base64

    return res.status(200).json({ signature });
  } catch (e) {
    console.error("sign-error:", e);
    return res.status(500).json({ error: "sign-error", details: e?.message });
  }
}

export const config = { runtime: "nodejs" };
