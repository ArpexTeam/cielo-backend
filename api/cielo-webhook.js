// api/cielo-webhook.js
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/** ---- Inicializa Firebase Admin (v11+ modular) ---- */
function initAdmin() {
  if (getApps().length) return;
  const hasSA =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  if (hasSA) {
    // Vercel/Node: a chave costuma vir com '\n' escapado
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  } else {
    // Usa credenciais padrão do ambiente (ex.: Workload Identity / GOOGLE_APPLICATION_CREDENTIALS)
    initializeApp({ credential: applicationDefault() });
  }
}
initAdmin();

const db = getFirestore();

/** ---- Helpers ---- */
function isPaidStatus(payload) {
  const s = String(payload?.Status ?? payload?.status ?? "").toLowerCase();
  if (s.includes("paid") || s.includes("aprov")) return true;

  // Alguns webhooks da Cielo trazem números (2=Autorizado, 3=Pago, etc.)
  const ps = Number(payload?.Payment?.Status ?? payload?.payment?.status ?? -1);
  return [2, 3].includes(ps);
}

/** ---- Handler ---- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const payload = req.body || {};
    const orderNumber = String(
      payload?.OrderNumber ??
        payload?.orderNumber ??
        payload?.OrderNumberId ??
        ""
    ).trim();

    if (!orderNumber) {
      return res.status(400).json({ ok: false, error: "OrderNumber ausente" });
    }

    // Busca o intent deste pedido
    const intentsSnap = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    const intentRef = intentsSnap.empty ? null : intentsSnap.docs[0].ref;
    const intentData = intentsSnap.empty ? {} : intentsSnap.docs[0].data();

    // Se NÃO aprovado, apenas marca o intent e encerra
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
      return res.status(200).json({ ok: true, message: "Notificado (nao_aprovado)" });
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

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("cielo-webhook error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
