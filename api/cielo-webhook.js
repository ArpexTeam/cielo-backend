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
  // Tente usar req.body (Vercel costuma parsear JSON/URL-encoded)
  let b = req.body;

  if (b == null || b === "") {
    const raw = await readRawBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return parseQS(raw);
    }
  }

  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return parseQS(b);
    }
  }

  return b;
}

function getOrderNumber(payload) {
  // Campos mais usuais no Checkout Cielo
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
  // Textual (raríssimo no Checkout, mas deixo robusto)
  const stText = String(payload?.Status ?? payload?.status ?? "").toLowerCase();
  if (/^(paid|pago|captur)/i.test(stText)) return true;

  // Checkout Cielo manda form-data com payment_status = "1|2|3|4|5"
  // 1=Pendente, 2=Pago, 3=Negado, 4=Expirado, 5=Cancelado
  // Só 2 é aprovado.
  const psRaw =
    payload?.payment_status ??
    payload?.PaymentStatus ??
    payload?.Payment?.Status ??
    payload?.payment?.status;

  const ps = Number(Array.isArray(psRaw) ? psRaw[0] : psRaw);
  return ps === 2;
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
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

    const pagamentoData = {
      provedor: "online",
      gateway: "cielo",
      orderNumber,
      raw: payload,
      lastNotification: FieldValue.serverTimestamp(),
    };

    // NÃO APROVADO (pendente/negado/expirado/cancelado)
    if (!isPaidStatus(payload)) {
      if (intentRef) {
        await intentRef.set(
          { status: "nao_aprovado", ...pagamentoData },
          { merge: true }
        );
      }
      console.log(`[webhook] Pedido ${orderNumber} não aprovado (status != 2).`);
      return res.status(200).json({ ok: true, processed: true, approved: false });
    }

    // APROVADO
    const itens = Array.isArray(intentData?.itens) ? intentData.itens : [];
    const total = Number(intentData?.total ?? 0);

    // Se ainda não houver intent (raro por corrida), não crie pedido vazio.
    // Em vez disso, marque um "orphan" para análise e deixe a Cielo re-notificar.
    if (!intentRef) {
      await db.collection("webhookOrphans").add({
        createdAt: FieldValue.serverTimestamp(),
        reason: "intent_not_found",
        orderNumber,
        payload,
      });
      console.warn(`[webhook] Aprovado mas sem intent: ${orderNumber}. Registrado em webhookOrphans.`);
      return res.status(200).json({ ok: true, processed: true, approved: true, pendingIntent: true });
    }

    // Idempotência por orderNumber
    const pedidosSnap = await db
      .collection("pedidos")
      .where("pagamento.orderNumber", "==", orderNumber)
      .limit(1)
      .get();

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

    await intentRef.set({ status: "aprovado", ...pagamentoData }, { merge: true });

    return res.status(200).json({ ok: true, processed: true, approved: true });
  } catch (e) {
    console.error("cielo-webhook error:", e);
    // Mantém 200 para não gerar retentativas agressivas
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
