# Catálogos no Firebase

O projeto **giannino-bistrot** contém o banco Firestore **catalogo**, na edição
**Enterprise**, com acesso nativo, localizado em **Milão (europe-west8)**. A
proteção contra exclusão está ativada. O Firebase confirmou `freeTier: true`
na criação; não foi necessário alterar o plano de faturamento do projeto.

[Abrir os dados no Console Firebase](https://console.firebase.google.com/project/giannino-bistrot/firestore/databases/catalogo/data).

## Conteúdo importado

| Seção | Categorias | Produtos |
| --- | ---: | ---: |
| Menù (`menu`) | 5 | 24 |
| Caffetteria (`caffetteria`) | 1 | 20 |
| Drink List (`drink`) | 19 | 119 |
| Carta dei Vini (`vini`) | 38 | 119 |
| **Total** | **63** | **282** |

As coleções são `sections` (4 documentos), `categories` (63), `products` (282)
e `_imports` (registro da migração). As seções usam `menu`, `caffetteria`,
`drink` e `vini` como IDs. Categorias e produtos mantêm os UUIDs originais.

Cada produto mantém `name`, `description`, `price`, `category_id`, `sort_order`,
`visible`, `available` e `created_at`. Também recebe `section`, `currency: EUR`
e `price_cents`, valor inteiro que facilita cálculos sem arredondamento:

```json
{
  "name": "1974",
  "description": "Suprema di pollo, con salsa alla Giuseppina e patate novelle al timo.",
  "price": "15,00",
  "price_cents": 1500,
  "currency": "EUR",
  "section": "menu",
  "category_id": "cd885296-3871-4939-b324-ba8658abd7b6",
  "sort_order": 0,
  "visible": true,
  "available": true
}
```

Os **30 produtos sem preço informado** mantêm `price: null` e
`price_cents: null`. Preços com texto livre, se adicionados no futuro, são
preservados em `price`, com `price_cents: null`.

O snapshot possui duas categorias (`Acque Minerali` e `Bibite`) que apontam
para uma categoria superior ausente. No Firestore, recebem `parent_id: null`
para manter a hierarquia íntegra, e `source_parent_id` guarda a referência
original. O snapshot versionado e todos os produtos dessas categorias são preservados.

## Migração e verificação

Para usar as ferramentas Firebase deste repositório:

```powershell
npm ci
npx -y firebase-tools@latest login
npm run firebase:plan
npm run firebase:import
npm run firebase:verify
```

Por padrão, a fonte é `data/site.json`, o mesmo snapshot utilizado na
publicação do GitHub Pages. Para escolher outra fonte:

```powershell
npm run firebase:plan -- --source data/site.json
npm run firebase:import -- --source data/site.json
npm run firebase:verify -- --source data/site.json
```

`plan` apenas valida e apresenta as quantidades e o SHA-256 do catálogo, sem
acessar o Firebase. `import` confirma a edição e a região do banco e cria os
documentos ausentes em uma única transação. Se algum documento existente tiver
sido editado, aborta a operação inteira para preservar as edições. Não exclui
documentos nem sobrescreve conteúdo. Executar novamente com a mesma fonte é
seguro e não duplica produtos. O limite desta migração atômica é 499 documentos
de catálogo, além do registro de importação.

`verify` busca cada documento por ID e compara **todos os campos** com a fonte.
Uma edição feita diretamente no Console gera uma divergência esperada em
relação ao snapshot; esse comando não reverte a edição.

A autenticação padrão usa a conta selecionada na Firebase CLI, com o token
mantido somente em memória. Não cria arquivos de credenciais. Para usar
Application Default Credentials já configuradas, acrescente `--auth adc`.
Não defina `FIRESTORE_EMULATOR_HOST` ao trabalhar com o banco remoto.

Neste Windows, se o Node.js 22.19 ou superior encontrar um erro de certificado
da rede, use o armazenamento de certificados confiáveis do sistema na sessão:

```powershell
$env:NODE_OPTIONS = (($env:NODE_OPTIONS + ' --use-system-ca').Trim())
```

## Acesso e configuração

As regras de segurança são um protótipo fechado: negam leitura e escrita
diretas a clientes web/mobile. A administração pelo Console Firebase e as
ferramentas de servidor usam as permissões IAM do projeto. Revise as regras ao
implementar novos acessos. Os índices em `firestore.indexes.json` permitem
consultas por seção ou categoria com ordenação.

```powershell
npx -y firebase-tools@latest deploy --only firestore --project giannino-bistrot --dry-run
npx -y firebase-tools@latest deploy --only firestore --project giannino-bistrot
```

O site é hospedado exclusivamente no GitHub Pages e lê os JSON gerados a
partir de `data/site.json`. O banco remoto e as ferramentas de migração são
independentes dessa publicação. Alterações no Console Firebase não atualizam
automaticamente o snapshot nem o site. Não é necessário registrar um aplicativo
web para administrar este banco pelo Console ou pelas ferramentas de migração.

As dependências Firebase são ferramentas de desenvolvimento e não são
incluídas no pacote do site. O build e os testes da publicação usam bibliotecas
nativas do Node.js.
