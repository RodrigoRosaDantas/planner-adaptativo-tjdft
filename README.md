# Planner Adaptativo TJDFT — Lab

Laboratório independente para testar um modelo adaptativo de estudo para o TJDFT, com foco em:

- Técnico Judiciário — Área Administrativa
- Analista Judiciário — Administração

## Objetivo

Validar um fluxo de estudo orientado por dados antes de levar a lógica para o dashboard oficial do TJDFT.

O laboratório combina:

- edital verticalizado;
- trilha real P01–P18 / RL01–RL13 / REV01–REV06;
- desempenho por unidade;
- revisões D0/D7/D20;
- caderno de erros;
- recomendação "o que estudar agora?";
- mapa de domínio;
- simulador de blueprint;
- registro local de sessões.

## Política de dados

A semente inicial é derivada do repositório `RodrigoRosaDantas/tjdft-dashboard`.

O campo de prioridade/score deste laboratório é **experimental**. Ele não deve ser confundido com incidência histórica oficial da banca. Onde não há incidência validada, o sistema usa sinais observáveis do próprio projeto (prioridade editorial, estado da trilha, desempenho e revisão).

As sessões criadas neste laboratório ficam no `localStorage` do navegador e não alteram o dashboard oficial.

## Publicação

O projeto é estático e compatível com GitHub Pages. O workflow em `.github/workflows/pages.yml` publica o conteúdo da branch `main`.

## Arquitetura

- `index.html` — shell do app
- `styles.css` — interface responsiva
- `app.js` — motor adaptativo e interações
- `data/seed.json` — semente normalizada do TJDFT
- `manifest.webmanifest` — PWA básica

