import axios from 'axios';

const MERCHANT_ID = '1a73646f-0fb6-4816-ba96-c8cd7cdfce85';

const options = {
  method: 'POST',
  // a barra final geralmente não é necessária; pode manter, mas prefiro sem:
  url: 'https://cieloecommerce.cielo.com.br/api/public/v1/orders',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    MerchantId: MERCHANT_ID
  },
  data: {
    // use um número único para evitar rejeição por repetição < 24h
    OrderNumber: 'PED' + Date.now(),
    // alfanumérico, sem espaço/acentos, 1–20 chars
    SoftDescriptor: 'Nomefantasia',
    Cart: {
      Discount: { Type: 'Percent', Value: 0 }, // número (0–100)
      Items: [
        {
          Name: 'Produto01',
          Description: 'ProdutoExemplo01',
          UnitPrice: 100,   // centavos (R$1,00)
          Quantity: 1,
          Type: 'Asset',
          Sku: 'ABC001',
          Weight: 500       // normalmente em gramas
        }
      ]
    },
    Shipping: {
      Type: 'WithoutShipping', // frete fixo
      // Preço total do frete (centavos). Se for grátis, use 0.
      Price: 0,


    }
  },
  timeout: 20000,
  validateStatus: () => true
};

axios
  .request(options)
  .then(res => {
    console.log('Status:', res.status);
    console.log('Body:', res.data);
    if (res.status === 200 && res.data?.CheckoutUrl) {
      console.log('\n✅ CheckoutUrl:', res.data.CheckoutUrl);
    } else {
      console.error('\n⚠️ Falhou — veja detalhes acima.');
    }
  })
  .catch(err => console.error('Erro de rede:', err.message));
