# Gerenciamento do cardápio

O painel fica em [Accesso amministratore](https://edneypugliese.github.io/Giannino_Bistrot/admin/login/).
Depois do login Google autorizado, a página `/admin` mostra o catálogo completo
do Firestore `giannino-bistrot/catalogo`, incluindo registros ocultos ou
indisponíveis. O tema e as fontes são os mesmos do site público.

## Uso

- As abas **Menù**, **Caffetteria**, **Drink List** e **Carta dei Vini** mostram
  os itens da seção selecionada. Ao trocar de aba, a busca é limpa e a lista
  retorna à primeira página de produtos.
- O único filtro é a busca por nome, descrição, categoria ou ID, sempre dentro
  da aba selecionada.
- **Prodotti** e **Categorie** alternam entre produtos e categorias da aba;
  ambas as listas permitem adicionar, editar ou excluir registros.
- **Tutti i dati della sezione** permite consultar todos os campos da seção
  selecionada. As abas também podem ser percorridas pelas setas do teclado.
- O formulário permite mudar nome, descrição, categoria, preço, ordenação,
  visibilidade e disponibilidade. Nas categorias, permite mudar também a
  descrição, o horário e a categoria superior.
- **Tutti i dati del record** mostra todos os campos armazenados, inclusive IDs,
  datas de criação e atualização e referências originais.

Preços usam a notação italiana (`15,50`). Campo vazio mantém preço não informado;
notas como `al calice` são preservadas. Preços numéricos também recebem o valor
inteiro em centavos (`price_cents`) e a moeda `EUR`.

Uma categoria com produtos ou subcategorias só pode ser excluída depois de
mover ou remover esses registros. A seção de uma categoria existente permanece
fixa; para mudar de seção, crie outra categoria e mova os produtos para ela.

## Persistência e publicação

O painel observa as coleções `sections`, `categories` e `products` em tempo
real. Os listeners padrão são necessários para receber também mudanças de
outras abas e do Console; as leituras pontuais para conferir relações e montar
a publicação usam pipelines do Firestore Enterprise.

Cada gravação usa uma transação para alterar o registro, incrementar
`_catalog/revision` e atualizar as projeções públicas das seções afetadas.
Falhas de validação, conexão ou publicação não deixam uma gravação parcial.
Uma edição antiga não sobrescreve um registro alterado em outra janela.
Datas novas são geradas pelo servidor com `serverTimestamp()`; datas originais
do snapshot são preservadas.

`public_catalogs/{section}` contém `schema_version: 1`, `payload` JSON e
`updated_at`. O payload inclui somente os campos públicos de categorias
visíveis e produtos visíveis/disponíveis. Categorias com ancestrais ocultos e
seções ocultas não são publicadas. Campos extras e metadados internos não são
incluídos. A projeção de cada seção suporta até 500.000 caracteres; exceder o
limite cancela a transação e exibe uma mensagem no formulário.

O site público lê essas quatro projeções sem login. Ao navegar ou recarregar o
cardápio, exibe os dados atualizados sem exigir novo commit ou build. Se o
Firebase ou a rede não responder em cinco segundos, exibe o snapshot estático
versionado, que pode conter dados anteriores. Visitantes que já mantêm um
cardápio aberto devem navegar novamente ou recarregá-lo para ver as alterações.

Edições feitas diretamente no Console não reconstruem automaticamente as
projeções públicas. Para reconstruí-las a partir dos dados atuais do banco,
utilize a conta da Firebase CLI ou ADC com permissão IAM:

```powershell
node scripts/publish-catalog.mjs --dry-run
node scripts/publish-catalog.mjs
# Alternativa: acrescente --auth-adc para usar ADC.
```

O script não altera produtos, categorias, seções ou registros de importação.
Na inicialização, publicou as quatro projeções com 63 categorias e 282 produtos.

## Código e verificação

- `public/assets/menu-manager.js`: tela React e formulários acessíveis.
- `public/assets/menu-manager.css`: estilos que herdam o tema do site.
- `public/assets/catalog-model.js`: validação, filtros e projeção pública.
- `src/catalog-store.js`: listeners, transações e leitura pública do Firestore.
- `public/assets/pages-runtime.js`: leitura do catálogo publicado com fallback.
- `tests/menu-manager.test.mjs` e `tests/menu-runtime.test.mjs`: validações,
  concorrência, CRUD, publicação, visibilidade e falhas de rede.

Execute `npm test`, `npm run check` e `npm run build:pages`. O bundle Firebase é
gerado pelo build e não contém credenciais privadas. A autorização e a validação
de acesso são aplicadas pelas regras do Firestore, além da tela de login.
