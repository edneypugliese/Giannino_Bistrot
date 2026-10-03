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

O aplicativo web **Giannino Bistrot Web** usa Firebase Authentication com
Google Sign-In. O domínio autorizado do site é `edneypugliese.github.io`.
O login está em `/Giannino_Bistrot/admin/login/` e o painel em `/Giannino_Bistrot/admin/`.

As regras exigem `email == edneypugleise@gmail.com`, `email_verified == true`
e `firebase.sign_in_provider == google.com` para ler o catálogo administrativo
ou gravar dados. O frontend confere os mesmos critérios, consulta o Firestore
para confirmar a autorização no servidor e desconecta contas não autorizadas.
Somente Google Sign-In está habilitado; email/senha e login anônimo estão desativados.

Categorias e produtos validam campos, tipos e limites em criação e atualização.
As mutações exigem incremento transacional de `_catalog/revision`, datas de
atualização geradas pelo servidor e preservação da data de criação. As seções
são somente leitura no painel. `_imports` e caminhos não previstos continuam
fechados aos clientes. O Console e as ferramentas de migração usam permissões IAM.

`public_catalogs/{menu|caffetteria|drink|vini}` permite leitura individual pública
das projeções de itens publicados. Listagem, exclusão e escrita não autorizada
são negadas. As projeções omitem dados administrativos e itens ocultos.
Os índices em `firestore.indexes.json` permitem consultas por seção ou categoria.

O comando `npm run firebase:security` testa as regras com a Firebase Rules API:
inclui contas de outros e-mails, email não verificado, outro provedor, ausência
de sessão, injeção de campos e dados inválidos. Ele precisa da sessão CLI;
os pedidos de teste e documentos relacionados são simulados, sem gravar produtos.

```powershell
npx -y firebase-tools@latest deploy --only auth,firestore --project giannino-bistrot --dry-run
npx -y firebase-tools@latest deploy --only auth,firestore --project giannino-bistrot
npm run firebase:auth-config
```

`firebase:auth-config` aplica e verifica os domínios e desativa os provedores
anônimo e email/senha pela Identity Toolkit API. A CLI utilizada habilita o
Google, mas não aplica `authorizedDomains` nem os valores `false` dos outros
provedores. Execute o comando acima após mudar a configuração de autenticação.

O site é hospedado exclusivamente no GitHub Pages. Os catálogos públicos
consultam as projeções do Firestore e usam os JSON de `data/site.json` como
fallback se a consulta remota falhar. O painel atualiza os dados e as projeções
na mesma transação. Alterações diretas no Console exigem republicar as projeções
com `node scripts/publish-catalog.mjs`; esse comando não modifica os registros originais.

`src/firebase-client.js` contém a configuração pública do aplicativo, os exports
`app`, `auth`, `db`, `catalogClient`, `subscribeAdminAuth`, `signInWithGoogle`
e `signOutAdmin`. `npm run build:firebase` gera `public/assets/firebase-client.js`,
também gerado automaticamente pelo build do Pages. Não há chaves privadas
ou credenciais de servidor no pacote publicado. Use `npm ci` para preparar
as dependências antes de construir ou testar o site.
