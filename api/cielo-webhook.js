// api/cielo-webhook.js
import * as admin from "firebase-admin";
try { admin.initializeApp(); } catch {}
const db = admin.firestore();

function isPaidStatus(payload) {
  const s = String(payload?.Status ?? payload?.status ?? "").toLowerCase();
  if (s.includes("paid") || s.includes("aprov")) return true;
  const ps = Number(payload?.Payment?.Status ?? payload?.payment?.status ?? -1);
  return [2, 3].includes(ps); // autorizado/confirmado (ajuste se necessário)
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const payload = req.body || {};
    const orderNumber = String(
      payload?.OrderNumber ?? payload?.orderNumber ?? payload?.OrderNumberId ?? ""
    ).trim();
    if (!orderNumber) return res.status(400).json({ ok: false, error: "OrderNumber ausente" });

    const intents = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    if (!isPaidStatus(payload)) {
      if (!intents.empty) {
        await intents.docs[0].ref.set(
          { status: "nao_aprovado", lastNotification: admin.firestore.FieldValue.serverTimestamp(), raw: payload },
          { merge: true }
        );
      }
      return res.status(200).json({ ok: true, message: "Notificado (nao_aprovado)" });
    }

    // Aprovado → cria/atualiza pedido
    const itens = intents.empty ? [] : intents.docs[0].data()?.itens || [];
    const total = intents.empty ? 0 : intents.docs[0].data()?.total || 0;

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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

    if (!intents.empty) {
      await intents.docs[0].ref.set(
        { status: "aprovado", lastNotification: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("cielo-webhook error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
