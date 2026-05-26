# SmartGuest Instagram — Instruções do Projeto

## Regras de conteúdo (SEMPRE seguir)

- **Todo post fala de IA.** Reels, Stories, Carousels — o tema central é sempre Inteligência Artificial aplicada à hotelaria.
- **Nunca falar de**: Booking/OTAs/canais de distribuição, precificação dinâmica/revenue management, quiz de perfis de gestor, temas genéricos de hotelaria sem IA.
- **Narrativa central**: O recepcionista era escravo da burocracia → a IA do SmartGuest assume o operacional → o recepcionista vira gerente e foca na experiência do hóspede.
- **Tom**: direto, provocativo, confiante. Sem ser técnico demais. Falar para o dono/gestor de pousada pequena.

## Formato dos posts

- **Manhã (10h BRT)**: Reels vertical 1080×1920, tipo IMAGE (feed permanente)
- **Noite (19h BRT)**: Story vertical 1080×1920, tipo STORIES (efêmero)
- Posts todos os dias, incluindo fins de semana e domingo
- Nunca usar tipo CAROUSEL para Reels — sempre IMAGE + slide: "story"

## Identidade visual

- Fundo escuro: `#060E12`
- Cor principal: `#16C3CC` (teal)
- Fonte título: Barlow Condensed 900
- Fonte texto: Inter
- Elemento fixo: barra teal no topo (5px), marca "SmartGuest" no canto

## Workflow GitHub Actions

- Arquivo: `.github/workflows/semana-maio.yml`
- Janela manhã: 12h–18h UTC (tolerância para atraso do GitHub)
- Janela noite: 21h–04h UTC
- Anti-duplicata: cache por post ID
- Para forçar republish: criar novo ID no agenda.json
