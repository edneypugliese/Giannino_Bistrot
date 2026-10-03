# Giannino Bistrot Cafè

Site público disponível exclusivamente no [GitHub Pages](https://edneypugliese.github.io/Giannino_Bistrot/), com a aparência e os conteúdos públicos do [site de referência](https://wrg41y-n2xaqy6l5-arcedawebapps1.vercel.app/).

Para acessar, abra o link acima ou dê dois cliques em **abrir-site.cmd**. O atalho abre o endereço online no navegador. A administração funciona online com Firebase; o projeto não possui servidor ou autenticação locais.

O cadeado do cabeçalho abre [Accesso amministratore](https://edneypugliese.github.io/Giannino_Bistrot/admin/login/). Clique em **ACCEDI CON GOOGLE**. Somente a conta **edneypugleise@gmail.com**, com e-mail verificado e login Google, pode abrir o painel e acessar os registros administrativos. Outras contas recebem **Accesso negato** e são desconectadas. As regras do Firestore também aplicam essa restrição.

## Publicação

O workflow `.github/workflows/pages.yml` verifica a sintaxe, executa os testes, gera os arquivos estáticos e publica automaticamente a cada push na branch `main`. A fonte em **Settings → Pages → Build and deployment** é **GitHub Actions**.

`npm run build:pages` gera a pasta `dist/` a partir de `public/` e do conteúdo versionado de `data/site.json`. Esse comando prepara o pacote de publicação; não inicia um servidor. O caminho padrão é `/Giannino_Bistrot/`. No workflow, o caminho é obtido da configuração do Pages. Para publicar na raiz de um domínio, use `node scripts/build-pages.mjs --base-path /`.

O build exporta apenas conteúdos visíveis e produtos disponíveis, ajusta caminhos de imagens e fontes e cria entradas para os links diretos de Home, Menù, Caffetteria, Drink List, Carta dei Vini, Contatti e páginas personalizadas. As entradas `/admin` e `/admin/login` estão reservadas à integração da administração online com Firebase. Rotas inexistentes exibem a página de conteúdo não encontrado.

Use `npm ci` antes do build ou dos testes. O build prepara o Firebase Web SDK com esbuild e inclui esse módulo no pacote estático. O servidor de hospedagem é o próprio GitHub Pages.

## Atualizar os conteúdos

Edite `data/site.json` para alterar textos, contatos, categorias, produtos, preços, disponibilidade e tema. Adicione imagens em `public/img/` e use caminhos como `/img/foto.jpg` no snapshot. Faça commit e push na `main`; o workflow publica as alterações.

Os catálogos públicos consultam as projeções do Firestore atualizadas pelo painel. Se essa consulta falhar, exibem o snapshot publicado no Pages. Home, tema e contatos continuam usando o snapshot. Arquivos e credenciais da antiga versão local não são utilizados pela publicação.

## Conteúdo preservado

- Home e história completas, assinatura, logo e fotografia da sala.
- Menù, Caffetteria, Drink List e Carta dei Vini: **63 categorias e 282 produtos** com descrições e preços originais.
- Contatos, navegação e índices de categorias.
- **23 famílias de fontes**, hospedadas junto com o site.

O Google Maps incorporado, Instagram e os links de telefone e email continuam disponíveis. Os scripts de gravação de sessões e edição da plataforma de referência foram removidos.

## Estrutura

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `public/index.html` | Entrada HTML do site |
| `public/assets/app.js` | Frontend compilado, sem dependências do servidor e da administração locais |
| `public/assets/pages-runtime.js` | Leitura dos arquivos JSON publicados no Pages |
| `public/assets/style.css` e `fonts.css` | Estilos e fontes |
| `public/img/` e `public/fonts/` | Imagens e arquivos de fontes |
| `data/site.json` | Conteúdos utilizados na publicação |
| `scripts/build-pages.mjs` | Geração do pacote estático `dist/` |
| `scripts/prepare-public-app.mjs` | Remoção reproduzível da administração do bundle de referência |
| `scripts/download_reference.py` | Atualização dos recursos públicos e do snapshot |
| `.github/workflows/pages.yml` | Testes, build e publicação automática |
| `vendor/` | Arquivos originais para rastreabilidade |
| `docs/download-manifest.json` | Origem, tamanho e SHA-256 dos recursos baixados |
| `docs/font-licenses/` | Licenças das fontes |

O código-fonte TSX original não está disponível. A preparação do frontend remove o antigo SDK de autenticação e as telas que dependiam da administração local, mantendo os componentes públicos e permitindo as integrações online. `npm run frontend:prepare` refaz essa adaptação a partir de `vendor/original-app.js`.

`python scripts/download_reference.py` refaz o download dos recursos públicos e aplica a mesma adaptação. Esse comando também atualiza `data/site.json`; revise as diferenças antes de publicar.

## Firebase

O Firestore do projeto **giannino-bistrot**, banco **catalogo**, guarda os catálogos administrados online. Consulte a [documentação Firebase](docs/firebase.md) e a [documentação do painel](docs/menu-manager.md). As alterações pelo painel atualizam as projeções públicas na mesma transação. Depois de editar diretamente no Console, reconstrua as projeções com `node scripts/publish-catalog.mjs`.

## Verificação

`npm run check` verifica a sintaxe. `npm test` verifica os recursos baixados, os catálogos, o frontend online, o build, os caminhos de mídia, os links diretos, a visibilidade e a remoção das dependências da administração local, sem abrir um servidor local.

A [verificação de fidelidade visual](docs/fidelidade-visual.md) registra as medidas comparadas com o site de referência.
