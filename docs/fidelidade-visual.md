# Comparação visual com o original

Verificação feita em 3 de outubro de 2026 na página `/contatti`, a partir da comparação enviada pelo usuário.

O CSS local é idêntico ao arquivo público `/assets/index-CB-neXhC.css`, descontando somente o import das fontes Google substituído por arquivos locais. O tema ativo em `.local/site.json` também coincide com a resposta pública `/api/theme` do original.

Na comparação enviada, a área de conteúdo de cada janela tem aproximadamente a mesma largura física. Entretanto, o original recebe **752 pixels CSS**, enquanto o site local recebe aproximadamente **836 pixels CSS**. A relação é compatível com o zoom local em **90%** do zoom usado no original. Como o layout muda a partir de **768 pixels CSS**, isso explica o título maior, o espaçamento diferente e o mapa ao lado na cópia.

Para comparar no Chrome, use **Ctrl+0 em cada uma das duas janelas**, mantenha as janelas com a mesma largura e abra a mesma página. O Chrome pode memorizar um zoom diferente para cada endereço, incluindo `localhost`.

## Medidas verificadas em condições iguais

As duas páginas foram medidas na mesma aba de navegador com dimensões controladas, aguardando a exibição dos contatos. As larguras abaixo representam a área útil após a barra de rolagem.

| Medida | Original a 737 px | Cópia a 737 px | Original a 925 px | Cópia a 925 px |
| --- | --- | --- | --- | --- |
| Tamanho do título | 36 px | 36 px | 60 px | 60 px |
| Largura do texto “Contatti” | 150,275 px | 150,275 px | 250,45 px | 250,45 px |
| Padding da página | 64 px / 24 px | 64 px / 24 px | 96 px / 48 px | 96 px / 48 px |
| Colunas do conteúdo | 688,8 px | 688,8 px | 382,4 px + 382,4 px | 382,4 px + 382,4 px |
| Espaço entre colunas/linhas | 40 px | 40 px | 64 px | 64 px |
| Largura do telefone | 123,025 px | 123,025 px | 123,025 px | 123,025 px |

As medidas do título, das fontes, dos espaçamentos e das colunas coincidem nas duas larguras. Não foi necessário modificar o layout para corrigir a diferença da imagem. Os overrides de viewport utilizados na verificação foram restaurados ao final; o zoom salvo do usuário não foi alterado.

O conteúdo dentro do iframe do Google Maps é renderizado pelo próprio Google e pode variar conforme o contexto do navegador. O endereço, a URL do iframe e o layout ao redor do mapa continuam preservados.
