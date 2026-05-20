/**
 * verificar-e-postar.js — Backup local do agendador (roda pelo Windows Task Scheduler)
 * Cobre todos os posts de maio e junho 2026.
 * Anti-dupla: registra em .postados.json antes de postar.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ── Agenda completa maio + junho 2026 ────────────────────
// Formato: 'DD/MM' → [post-manhã (10h BRT), post-noite (19h BRT)]
// null = sem post nesse turno
const AGENDA = {
  // ── MAIO ────────────────────────────────────────────────
  '21/05': ['qua21-carousel-custo-reserva',  'qua21-story-planilha'],
  '22/05': ['qui22-carousel-checkin',         'qui22-story-setup'],
  '23/05': ['sex23-carousel-corpus',          'sex23-story-avaliacoes'],
  '26/05': ['seg26-carousel-booking',         'seg26-story-quiz'],
  '27/05': ['ter27-carousel-revenue',         'ter27-story-depoimento'],
  '28/05': ['qua28-carousel-erro',            'qua28-story-precos'],
  '29/05': ['qui29-carousel-comparacao',      'qui29-story-tempo'],
  '30/05': ['sex30-carousel-junho',           'sex30-story-cta'],
  // ── SEMANA 3 (maio/jun) ─────────────────────────────────
  '31/05': ['ter31-carousel-case',            null],
  '01/06': ['qua01-post-depoimento',          null],
  '02/06': ['qui02-story-teste',              null],
  '03/06': ['sex03-carousel-faq',             null],
  // ── SEMANA 4 (junho) ────────────────────────────────────
  '06/06': ['seg06-carousel-ia2026',          null],
  '07/06': ['ter07-carousel-channel',         null],
  '08/06': ['qua08-story-quiz',               null],
  '09/06': ['qui09-post-comparativo',         null],
  '10/06': ['sex10-post-cta',                 null],
  // ── SEMANA 5 (junho) ────────────────────────────────────
  '11/06': ['seg11-carousel-whatsapp',        'seg11-story-quartos'],
  '12/06': ['ter12-carousel-hospede',         'ter12-story-checkin'],
  '13/06': ['qua13-carousel-avaliacao',       'qua13-story-quiz'],
  '14/06': ['qui14-carousel-comissao',        'qui14-story-canal'],
  '15/06': ['sex15-carousel-temporada',       'sex15-story-novidade'],
  // ── SEMANA 6 (junho) ────────────────────────────────────
  '18/06': ['seg18-carousel-link',            'seg18-story-avaliacao'],
  '19/06': ['ter19-carousel-recepcionista',   'ter19-story-motor'],
  '20/06': ['qua20-carousel-hospede',         'qua20-story-bastidores'],
  '21/06': ['qui21-carousel-metricas',        'qui21-story-dificuldade'],
  '22/06': ['sex22-carousel-pequenas',        'sex22-story-cta'],
};

// ── Anti-dupla-postagem ───────────────────────────────────
const RASTREIO = path.join(__dirname, '.postados.json');
function carregarRastreio() {
  try { return JSON.parse(fs.readFileSync(RASTREIO, 'utf8')); } catch { return {}; }
}
function marcarPostado(id) {
  const r = carregarRastreio();
  r[id] = new Date().toISOString();
  fs.writeFileSync(RASTREIO, JSON.stringify(r, null, 2));
}
function jaPostado(id) { return !!carregarRastreio()[id]; }

// ── Detectar post do momento ──────────────────────────────
function detectarPost() {
  const agora = new Date();
  // BRT = UTC-3
  const brt  = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const dia  = String(brt.getUTCDate()).padStart(2,'0');
  const mes  = String(brt.getUTCMonth()+1).padStart(2,'0');
  const hora = brt.getUTCHours();
  const chave = `${dia}/${mes}`;

  const slots = AGENDA[chave];
  if (!slots) return null;

  // Manhã: 9h–14h BRT → slots[0]
  // Noite: 18h–23h BRT → slots[1]
  if (hora >= 9  && hora < 14 && slots[0]) return slots[0];
  if (hora >= 18 && hora < 23 && slots[1]) return slots[1];
  return null;
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  const postId = process.argv[2] || detectarPost();

  if (!postId) {
    console.log(`[${new Date().toLocaleString('pt-BR')}] Nenhum post agendado agora.`);
    process.exit(0);
  }

  if (jaPostado(postId)) {
    console.log(`[${new Date().toLocaleString('pt-BR')}] ✅ '${postId}' já publicado. Pulando.`);
    process.exit(0);
  }

  console.log(`[${new Date().toLocaleString('pt-BR')}] 🚀 Postando: ${postId}`);

  try {
    execSync(`node "${path.join(__dirname,'postar.js')}" ${postId}`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        INSTAGRAM_TOKEN:   process.env.INSTAGRAM_TOKEN,
        INSTAGRAM_USER_ID: process.env.INSTAGRAM_USER_ID,
        IMGBB_KEY:         process.env.IMGBB_KEY || '',
      },
      cwd: __dirname
    });
    marcarPostado(postId);
    console.log(`✅ ${postId} publicado e registrado.`);
  } catch (err) {
    console.error(`❌ Erro em ${postId}: ${err.message}`);
    process.exit(1);
  }
})();
