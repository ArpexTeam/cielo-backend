// api/cielo-webhook.js
// Trata body como JSON **ou** form-encoded (string) e **não** devolve 400 se faltar OrderNumber.
// Usa Firebase Admin modular (v11+).

import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* -------------------- Firebase Admin init -------------------- */
(function initAdmin() {
  if (getApps().length) return;
  const hasSA =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  if (hasSA) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  } else {
    initializeApp({ credential: applicationDefault() });
  }
})();
const db = getFirestore();

/* -------------------- Utils -------------------- */
function safeJsonParse(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function parseBody(req) {
  const b = req.body;
  if (!b) return {};

  // Se já veio objeto (application/json), retorna direto
  if (typeof b === "object") return b;

  // String -> tenta JSON, senão form-encoded
  if (typeof b === "string") {
    const s = b.trim();
    if (!s) return {};

    const asJson = safeJsonParse(s);
    if (asJson && typeof asJson === "object") return asJson;

    // Tenta application/x-www-form-urlencoded
    try {
      const params = new URLSearchParams(s);
      const obj = {};
      for (const [k, v] of params) obj[k] = v;

      // Alguns gateways mandam campos-JSON como string
      ["Payment", "payment", "payload", "data"].forEach((k) => {
        const val = obj[k];
        if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
          const j = safeJsonParse(val);
          if (j) obj[k] = j;
        }
      });

      return obj;
    } catch {
      // Deixa como vazio mas mantém raw para log
      return { _raw: s };
    }
  }

  return {};
}

function extractOrderNumber(payload) {
  const v =
    payload?.OrderNumber ??
    payload?.orderNumber ??
    payload?.OrderNumberId ??
    payload?.order_number ??
    payload?.reference ??
    payload?.MerchantOrderId ??
    payload?.merchantOrderId ??
    "";
  return String(v || "").trim();
}

function isPaidStatus(payload) {
  const s = String(payload?.Status ?? payload?.status ?? "").toLowerCase();
  if (s.includes("paid") || s.includes("aprov")) return true;

  const ps = Number(payload?.Payment?.Status ?? payload?.payment?.status ?? -1);
  // 2=Autorizado, 3=Pago (ajuste se sua conta usar outros códigos)
  return [2, 3].includes(ps);
}

async function logWebhook(entry) {
  try {
    await db.collection("webhookLogs").add({
      ...entry,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("logWebhook error:", e?.message || e);
  }
}

/* -------------------- Handler -------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const payload = parseBody(req);
    const orderNumber = extractOrderNumber(payload);

    if (!orderNumber) {
      // Não quebra o fluxo da Cielo: loga e retorna 200
      await logWebhook({
        note: "missing-order-number",
        headers: {
          "content-type": req.headers["content-type"] || "",
          "user-agent": req.headers["user-agent"] || "",
        },
        payload,
      });
      return res.status(200).json({ ok: true, received: true, missingOrderNumber: true });
    }

    // Busca o intent deste pedido
    const intentsSnap = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    const intentRef = intentsSnap.empty ? null : intentsSnap.docs[0].ref;
    const intentData = intentsSnap.empty ? {} : intentsSnap.docs[0].data();

    // Não aprovado -> marca intent como não aprovado e encerra com 200
    if (!isPaidStatus(payload)) {
      if (intentRef) {
        await intentRef.set(
          {
            status: "nao_aprovado",
            lastNotification: FieldValue.serverTimestamp(),
            raw: payload,
          },
          { merge: true }
        );
      }
      await logWebhook({ note: "status-nao-aprovado", orderNumber, payload });
      return res.status(200).json({ ok: true, message: "Notificado (nao_aprovado)" });
    }

    // Aprovado -> cria/atualiza em "pedidos"
    const itens = Array.isArray(intentData?.itens) ? intentData.itens : [];
    const total = Number(intentData?.total ?? 0);

    const pedidosSnap = await db
      .collection("pedidos")
      .where("pagamento.orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    const pagamentoData = {
      provedor: "online",
      gateway: "cielo",
      orderNumber,
      raw: payload,
    };

    if (pedidosSnap.empty) {
      await db.collection("pedidos").add({
        createdAt: FieldValue.serverTimestamp(),
        itens,
        total,
        status: "aprovado",
        tipoServico: "Online",
        pagamento: pagamentoData,
      });
    } else {
      await pedidosSnap.docs[0].ref.set(
        { status: "aprovado", pagamento: pagamentoData },
        { merge: true }
      );
    }

    if (intentRef) {
      await intentRef.set(
        { status: "aprovado", lastNotification: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    await logWebhook({ note: "status-aprovado", orderNumber, ok: true });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("cielo-webhook error:", e);
    await logWebhook({ note: "exception", error: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
