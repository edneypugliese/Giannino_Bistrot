# Giannino Bistrot Cafè — cópia local

Clone do [site de referência](https://wrg41y-n2xaqy6l5-arcedawebapps1.vercel.app/), com o frontend público original, imagens, ícones, fontes e snapshot dos conteúdos. O servidor Node.js replica as APIs e a autenticação para uso neste computador. Não precisa de npm install, Supabase ou conexão com o site original para exibir os conteúdos.

## Abrir no Windows

1. Dê dois cliques em **iniciar-site.cmd** nesta pasta, ou execute `npm start` no terminal.
2. Abra **http://localhost:3000**.
3. Deixe o terminal aberto enquanto utiliza o site. `Ctrl+C` encerra o servidor.

Requer Node.js 20 ou superior, já instalado neste computador. Para outra porta, execute `$env:PORT=3001; npm start` no PowerShell.

## Painel administrativo

Acesse **http://localhost:3000/admin/login**. O usuário inicial é **admin**; a senha é gerada no primeiro uso e fica em **.local/ACESSO-LOCAL.txt**. As credenciais originais do site não são utilizadas.

O painel original permite editar home, imagens, eventos, páginas, categorias, produtos, preços, disponibilidade, contatos e design. O backend grava alterações em **.local/site.json** e imagens enviadas em **.local/uploads/**. Essa pasta é privada ao checkout e ignorada pelo Git. Faça uma cópia dela para guardar suas edições. Reiniciar o servidor preserva os dados e exige novo login.

Para definir sua própria senha na próxima inicialização, use `$env:LOCAL_ADMIN_PASSWORD='sua-senha'; npm start`. O servidor escuta somente em `127.0.0.1`; esta implementação é destinada ao uso local.

## Conteúdo preservado

- Home e história completas, assinatura, logo e fotografia da sala.
- Menù, Caffetteria, Drink List e Carta dei Vini: **63 categorias e 282 produtos** com descrições e preços originais.
- Página de contatos, navegação, índices de categorias e interface administrativa.
- **23 famílias de fontes** disponíveis no editor, baixadas para uso offline.

O mapa incorporado do Google Maps, Instagram e links externos ainda precisam de internet. O restante dos arquivos e dos dados iniciais é servido pelo computador. Não foram copiados dados privados, senhas nem o banco remoto. Os scripts de gravação de sessões e de edição da plataforma de referência foram removidos do HTML local.

## Estrutura e edição

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `public/index.html` | Entrada HTML sem scripts da plataforma externa |
| `public/assets/app.js` | Frontend compilado original com autenticação e fontes locais |
| `public/assets/local-auth.js` | Adaptador de sessão para o servidor local |
| `public/assets/style.css` e `fonts.css` | Estilos originais e fontes locais |
| `public/img/` e `public/fonts/` | Imagens e arquivos de fontes baixados |
| `server/index.mjs` | APIs, sessão administrativa, uploads e servidor HTTP |
| `data/site.json` | Snapshot inicial dos dados públicos |
| `vendor/` | JavaScript, CSS e respostas públicas originais para rastreabilidade |
| `docs/download-manifest.json` | Origem, tamanho e SHA-256 de cada arquivo baixado |
| `docs/font-licenses/` | Licenças OFL das famílias de fontes baixadas |
| `scripts/download_reference.py` | Download reproduzível e aplicação das adaptações locais |

O site publicado fornece os arquivos compilados; seu código-fonte TSX original não está disponível. O frontend baixado foi preservado para manter a fidelidade. Conteúdos e aparência podem ser editados pelo painel; o servidor e o adaptador local possuem código-fonte legível.

`python scripts/download_reference.py` refaz o download dos recursos públicos e atualiza o snapshot inicial. **Não altera suas edições em .local/**. Revise as diferenças antes de incorporar uma nova versão da referência.

## Firebase

O Firestore do projeto **giannino-bistrot**, banco **catalogo**, em Milão,
armazena as 4 seções, 63 categorias e 282 produtos com descrições, preços em
euros, ordenação, visibilidade e disponibilidade. Consulte a
[documentação do banco e das ferramentas de importação](docs/firebase.md).
O servidor local continua usando seu arquivo de dados; o banco pode ser
administrado pelo Console Firebase. As ferramentas opcionais de migração
precisam de `npm ci`.

## Verificação

`npm run check` verifica a sintaxe. `npm test` testa os catálogos, recursos locais, controle de acesso, gravação persistente, CRUD, visibilidade, ordenação e uploads, usando uma pasta temporária independente dos seus dados.

Para comparar a aparência com o original, use **Ctrl+0 nas duas janelas do navegador** e mantenha a mesma largura. O Chrome pode salvar um zoom diferente para `localhost`, alterando o tamanho dos textos e o ponto em que o mapa passa para a segunda coluna. A [verificação de fidelidade visual](docs/fidelidade-visual.md) registra as medidas conferidas em condições iguais.
