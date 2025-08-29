declare const CriarPGinaCheckoutApi: {
    readonly body: {
        readonly type: "object";
        readonly properties: {
            readonly OrderNumber: {
                readonly type: "string";
                readonly description: "Número do pedido da loja. <br>Se não for enviado, o Checkout Cielo gerará um número, que será visualizado pelo consumidor.<br> Para fins de conciliação, os caracteres permitidos são apenas a-z, A-Z, 0-9, não permitido caracteres especiais e espaços em branco.<br> Tamanho máximo: 20.";
                readonly examples: readonly ["Pedido01"];
            };
            readonly SoftDescriptor: {
                readonly type: "string";
                readonly description: "Descrição a ser apresentada na fatura do cartão de crédito do portador. Tamanho máximo: 13.";
                readonly examples: readonly ["Nomefantasia"];
            };
            readonly Cart: {
                readonly properties: {
                    readonly Discount: {
                        readonly properties: {
                            readonly Type: {
                                readonly type: "string";
                                readonly description: "**Obrigatório caso pagamento tenha desconto no carrinho.** Tipo do desconto: \"Amount\" ou \"Percent\". Tamanho máximo: 255.";
                            };
                            readonly Value: {
                                readonly type: "integer";
                                readonly description: "**Obrigatório caso pagamento tenha desconto no carrinho.** Valor do desconto. Tamanho máximo: 18.";
                                readonly format: "int32";
                                readonly minimum: -2147483648;
                                readonly maximum: 2147483647;
                            };
                        };
                        readonly required: readonly [];
                        readonly type: "object";
                    };
                    readonly Items: {
                        readonly type: "array";
                        readonly description: "Informações sobre os itens no carrinho.";
                        readonly items: {
                            readonly properties: {
                                readonly "Cart.Items.Name": {
                                    readonly type: "string";
                                    readonly description: "Nome do item no carrinho. <br>Exemplo: Pedido ABC. <br>Tamanho máximo: 128";
                                };
                                readonly "Cart.Items.Description": {
                                    readonly type: "string";
                                    readonly description: "Descrição do item no carrinho. <br>Exemplo: 50 canetas - R$30,00. <br>Tamanho máximo: 256.";
                                };
                                readonly "Cart.Items.UnitPrice": {
                                    readonly type: "integer";
                                    readonly description: "Preço unitário do produto em centavos. <br>Exemplo: R$ 1,00 = 100 <br>Tamanho máximo: 18.";
                                    readonly format: "int32";
                                    readonly minimum: -2147483648;
                                    readonly maximum: 2147483647;
                                };
                                readonly "Cart.Items.Quantity": {
                                    readonly type: "integer";
                                    readonly description: "Quantidade do item no carrinho. <br>Exemplo: 1. <br>Tamanho máximo: 9.";
                                    readonly format: "int32";
                                    readonly minimum: -2147483648;
                                    readonly maximum: 2147483647;
                                };
                                readonly "Cart.Items.Type": {
                                    readonly type: "string";
                                    readonly description: "Tipo do item no carrinho. <br>Exemplo: Asset; <br>Digital; <br>Service; <br>Payment<br>Recurrent.<br> Tamanho máximo: 255.";
                                };
                                readonly "Cart.Items.Sku": {
                                    readonly type: "string";
                                    readonly description: "Identificador do produto. <br>Tamanho máximo: 32.";
                                };
                                readonly "Cart.Items.Weight": {
                                    readonly type: "integer";
                                    readonly description: "Peso do produto. <br>Tamanho máximo: 9.";
                                    readonly format: "int32";
                                    readonly minimum: -2147483648;
                                    readonly maximum: 2147483647;
                                };
                            };
                            readonly required: readonly ["Cart.Items.Name", "Cart.Items.UnitPrice", "Cart.Items.Quantity", "Cart.Items.Type"];
                            readonly type: "object";
                        };
                    };
                };
                readonly required: readonly [];
                readonly type: "object";
                readonly description: "Informações sobre o carrinho. O nó `Cart` deve ser repetido para cada item incluso no carrinho do comprador.";
            };
            readonly Payment: {
                readonly properties: {
                    readonly BoletoDiscount: {
                        readonly type: "integer";
                        readonly description: "**Obrigatório caso o pagamento por boleto tenha desconto.** Desconto, em porcentagem, para pagamentos a serem realizados com boleto. Tamanho máximo: 3.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly RecurrentPayment: {
                        readonly properties: {
                            readonly Interval: {
                                readonly type: "string";
                                readonly description: "**Obrigatório caso o pagamento seja recorrente**. Intervalo entre cada transação da recorrência. <br>“Monthly” para mensal; <br>“Bimonthly” para bimestral <br>“Quarterly” para trimestral <br>“SemiAnnual” para semestral<br> “Annual” para anual. <br>Tamanho máximo: 10.";
                            };
                            readonly EndDate: {
                                readonly type: "string";
                                readonly description: "**Obrigatório caso o pagamento seja recorrente**. Data de encerramento da recorrência. Se não enviado, a recorrência se encerra somente se cancelada. Tamanho máximo: 255.";
                                readonly format: "date";
                            };
                        };
                        readonly required: readonly [];
                        readonly type: "object";
                    };
                    readonly FirstInstallmentDiscount: {
                        readonly type: "integer";
                        readonly description: "**Obrigatório caso o pagamento à vista tenha desconto.** Desconto, em porcentagem, para pagamentos à vista no cartão de crédito. Tamanho: 3.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly MaxNumberOfInstallments: {
                        readonly type: "string";
                        readonly description: "**Obrigatório caso o pagamento for parcelado**. Define número máximo de parcelas apresentadas na página de pagamento. Tamanho: 3.";
                    };
                    readonly FixedInstallments: {
                        readonly type: "integer";
                        readonly description: "Número fixo e único de parcelas que o comprador pode selecionar na tela de pagamento, caso a loja deseje especificar uma quantidade de parcelas exata que o portador pode escolher. **Atenção: não envie esse campo se o tipo de produto (type) for igual a “Recurrent”.** Tamanho: até 2 caracteres (1 a 18 parcelas).";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                };
                readonly required: readonly [];
                readonly type: "object";
            };
            readonly Customer: {
                readonly properties: {
                    readonly Identity: {
                        readonly type: "integer";
                        readonly description: "Identificação do comprador (CPF ou CNPJ). Se enviado, esse valor já vem preenchido na tela do Checkout Cielo. Não obrigatório na API, mas obrigatório na tela transacional. Tamanho máximo: 14.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly FullName: {
                        readonly type: "string";
                        readonly description: "Nome completo do comprador. Não obrigatório na API, mas obrigatório na tela transacional. Tamanho máximo: 288.";
                    };
                    readonly Email: {
                        readonly type: "string";
                        readonly description: "E-mail do comprador. Se enviado, esse valor já vem preenchido na tela do Checkout Cielo. Não obrigatório na API, mas obrigatório na tela transacional. Tamanho máximo: 64.";
                    };
                    readonly Phone: {
                        readonly type: "integer";
                        readonly description: "Telefone do comprador. Se enviado, esse valor já vem preenchido na tela do Checkout Cielo. Não obrigatório na API, mas obrigatório na tela transacional. Tamanho: 11.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                };
                readonly required: readonly [];
                readonly type: "object";
                readonly description: "Dados do comprador.";
            };
            readonly Options: {
                readonly properties: {
                    readonly ReturnUrl: {
                        readonly type: "string";
                        readonly description: "URL fixa definida pela loja que pode ser registrada no backoffice Checkout. Após finalizar o pagamento, o comprador pode ser redirecionado para uma página definida web pela loja. Tamanho: 255.";
                    };
                };
                readonly required: readonly [];
                readonly type: "object";
            };
            readonly Shipping: {
                readonly properties: {
                    readonly Type: {
                        readonly type: "string";
                        readonly description: "Tipo do frete: <br>Correios; <br>FixedAmount; <br>Free; <br>WithoutShippingPickUp; <br>WithoutShipping. <br> Tamanho máximo: 255.";
                    };
                    readonly SourceZipCode: {
                        readonly type: "integer";
                        readonly description: "CEP de origem do carrinho de compras. Obrigatório caso Shipping.Type seja “Correios”*. Tamanho: 8.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly TargetZipCode: {
                        readonly type: "integer";
                        readonly description: "CEP do endereço de entrega do comprador. Tamanho: 8.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly Address: {
                        readonly properties: {
                            readonly Street: {
                                readonly type: "string";
                                readonly description: "Rua, avenida, travessa, etc, do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar. Tamanho: 256.";
                            };
                            readonly Number: {
                                readonly type: "string";
                                readonly description: "Número do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar. Tamanho máximo: 8.";
                            };
                            readonly Complement: {
                                readonly type: "string";
                                readonly description: "Complemento do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar. Tamanho máximo: 14.";
                            };
                            readonly District: {
                                readonly type: "string";
                                readonly description: "Bairro do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar.";
                            };
                            readonly City: {
                                readonly type: "string";
                                readonly description: "Cidade do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar. Tamanho máximo: 64.";
                            };
                            readonly State: {
                                readonly type: "string";
                                readonly description: "Estado (UF) do endereço de entrega do comprador. Não é obrigatório, mas recomendamos enviar. Tamanho máximo: 2.";
                            };
                        };
                        readonly required: readonly [];
                        readonly type: "object";
                    };
                    readonly Services: {
                        readonly properties: {
                            readonly Name: {
                                readonly type: "string";
                                readonly description: "Nome do serviço de frete. Tamanho máximo: 128.";
                            };
                            readonly Price: {
                                readonly type: "integer";
                                readonly description: "Preço do serviço de frete em centavos. <br>Exemplo: R$ 1,00 = 100.<br> Tamanho máximo: 18.";
                                readonly format: "int32";
                                readonly minimum: -2147483648;
                                readonly maximum: 2147483647;
                            };
                            readonly Deadline: {
                                readonly type: "integer";
                                readonly description: "Prazo de entrega (em dias). Tamanho máximo: 9.";
                                readonly format: "int32";
                                readonly minimum: -2147483648;
                                readonly maximum: 2147483647;
                            };
                        };
                        readonly required: readonly ["Name", "Price"];
                        readonly type: "object";
                    };
                    readonly Package: {
                        readonly type: "string";
                        readonly description: "Tipo de pacote: <br>“Box”: caixa; <br>“Rol”: cilindro ou envelope.";
                    };
                    readonly Length: {
                        readonly type: "integer";
                        readonly description: "Comprimento do pacote.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly Height: {
                        readonly type: "integer";
                        readonly description: "**Obrigatório caso Shipping.Package como “Box”**. Altura do pacote enviado.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly Width: {
                        readonly type: "integer";
                        readonly description: "**Obrigatório caso Shipping.Package seja “Box” ou “Envelope”**. Largura do pacote.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                    readonly Diameter: {
                        readonly type: "integer";
                        readonly description: "**Obrigatório caso Shipping.Package como “Rol”**. Diâmetro do pacote.";
                        readonly format: "int32";
                        readonly minimum: -2147483648;
                        readonly maximum: 2147483647;
                    };
                };
                readonly required: readonly ["Package", "Length"];
                readonly type: "object";
                readonly description: "Informações do endereço de entrega";
            };
        };
        readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly MerchantId: {
                    readonly type: "string";
                    readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
                    readonly description: "Identificador único da loja fornecido pela Cielo após a afiliação da loja. Formato: 00000000-0000-0000-0000-000000000000";
                };
                readonly "Content-type": {
                    readonly type: "string";
                    readonly default: "application/json";
                    readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
                    readonly description: "Tipo do conteúdo da mensagem a ser enviada.";
                };
            };
            readonly required: readonly ["MerchantId", "Content-type"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly type: "object";
            readonly properties: {
                readonly Settings: {
                    readonly type: "object";
                    readonly properties: {
                        readonly CheckoutUrl: {
                            readonly type: "string";
                            readonly examples: readonly ["https://cieloecommerce.cielo.com.br/transacional/order/index?id=123"];
                        };
                        readonly Profile: {
                            readonly type: "string";
                            readonly examples: readonly ["CheckoutCielo"];
                        };
                        readonly Version: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [1];
                        };
                    };
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {
                readonly message: {
                    readonly type: "string";
                    readonly examples: readonly ["An error has occurred."];
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
export { CriarPGinaCheckoutApi };
