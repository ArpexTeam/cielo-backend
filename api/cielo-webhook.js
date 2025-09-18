// api/cielo-webhook.js
import { parse as parseQS } from "querystring";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* ---------------- Firebase Admin (v11 modular) ---------------- */
function initAdmin() {
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
}
initAdmin();

const db = getFirestore();

/* ---------------- Helpers ---------------- */
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  // Tente usar req.body (Vercel já parseia JSON/URL-encoded na maioria dos casos)
  let b = req.body;

  // Se vier vazio/indefinido, leia o raw e tente parsear
  if (b == null || b === "") {
    const raw = await readRawBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (_) {
      // tenta form-encoded
      return parseQS(raw);
    }
  }

  // Se for string, tente JSON e depois form-encoded
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch (_) {
      return parseQS(b);
    }
  }

  // Já é objeto
  return b;
}

function getOrderNumber(payload) {
  // Cobre variações mais comuns que já vimos no painel e no webhook
  const cand =
    payload?.order_number ??
    payload?.OrderNumber ??
    payload?.orderNumber ??
    payload?.OrderNumberId ??
    payload?.orderNumberId ??
    payload?.order?.number ??
    "";

  return String(cand || "").trim();
}

function isPaidStatus(payload) {
  // às vezes vem string textual
  const s = String(payload?.Status ?? payload?.status ?? "").toLowerCase();
  if (/(paid|aprov|confirm|captur|authorized|autorizado)/i.test(s)) return true;

  // Checkout Cielo costuma mandar "payment_status" = "1" (string)
  const ps = Number(
    payload?.payment_status ??
      payload?.PaymentStatus ??
      payload?.Payment?.Status ??
      payload?.payment?.status ??
      -1
  );

  // Considere 1/2/3 como estados positivos (ajuste se necessário para sua conta)
  return [1, 2, 3].includes(ps);
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    // Webhook é server-to-server; 405 não ajuda a Cielo.
    return res.status(200).json({ ok: true, ignored: true, reason: "not-post" });
  }

  try {
    const payload = await parseBody(req);
    const orderNumber = getOrderNumber(payload);

    if (!orderNumber) {
      console.warn("[webhook] Sem orderNumber no payload. Ignorando.", payload);
      return res.status(200).json({ ok: true, ignored: true, reason: "no-order-number" });
    }

    // Busca o intent deste pedido
    const intentsSnap = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    const intentRef = intentsSnap.empty ? null : intentsSnap.docs[0].ref;
    const intentData = intentsSnap.empty ? {} : intentsSnap.docs[0].data();

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
      console.log(`[webhook] Pedido ${orderNumber} NÃO aprovado.`);
      return res.status(200).json({ ok: true, processed: true, approved: false });
    }

    // Aprovado → cria/atualiza "pedidos"
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
      console.log(`[webhook] Criado pedido aprovado para ${orderNumber}.`);
    } else {
      await pedidosSnap.docs[0].ref.set(
        { status: "aprovado", pagamento: pagamentoData },
        { merge: true }
      );
      console.log(`[webhook] Atualizado pedido aprovado para ${orderNumber}.`);
    }

    if (intentRef) {
      await intentRef.set(
        { status: "aprovado", lastNotification: FieldValue.serverTimestamp(), raw: payload },
        { merge: true }
      );
    }

    return res.status(200).json({ ok: true, processed: true, approved: true });
  } catch (e) {
    console.error("cielo-webhook error:", e);
    // Mesmo em erro, devolvemos 200 para não gerar re-tentativas agressivas da Cielo
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
