/**
 * postar-agora.js — Dispara qualquer post via GitHub Actions API
 * Uso: node postar-agora.js <post-id>
 * Ex:  node postar-agora.js qua21-carousel-custo-reserva
 *
 * Sem argumentos: detecta automaticamente o post do dia e hora atual
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN_SMARTGUEST;
if (!GITHUB_TOKEN) {
  console.error('❌ Defina a variável GITHUB_TOKEN_SMARTGUEST');
  process.exit(1);
}
const REPO         = 'maxsuelder/smartguest-instagram';
const WORKFLOW     = 'semana-maio.yml';

// Mapeamento completo maio 2026
const AGENDA = {
  '05-20-13': 'ter20-carousel-hospede-volta',
  '05-20-22': 'ter20-story-rate-parity',
  '05-21-13': 'qua21-carousel-custo-reserva',
  '05-21-22': 'qua21-story-planilha',
  '05-22-13': 'qui22-carousel-checkin',
  '05-22-22': 'qui22-story-setup',
  '05-23-13': 'sex23-carousel-corpus',
  '05-23-22': 'sex23-story-avaliacoes',
  '05-26-13': 'seg26-carousel-booking',
  '05-26-22': 'seg26-story-quiz',
  '05-27-13': 'ter27-carousel-revenue',
  '05-27-22': 'ter27-story-depoimento',
  '05-28-13': 'qua28-carousel-erro',
  '05-28-22': 'qua28-story-precos',
  '05-29-13': 'qui29-carousel-comparacao',
  '05-29-22': 'qui29-story-tempo',
  '05-30-13': 'sex30-carousel-junho',
  '05-30-22': 'sex30-story-cta',
};

function detectarPostDoDia() {
  const agora = new Date();
  const mes  = String(agora.getUTCMonth() + 1).padStart(2, '0');
  const dia  = String(agora.getUTCDate()).padStart(2, '0');
  const hora = String(agora.getUTCHours()).padStart(2, '0');
  const chave = `${mes}-${dia}-${hora}`;
  return AGENDA[chave] || null;
}

function dispararWorkflow(postId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ref: 'main', inputs: { post_id: postId } });
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'smartguest-bot'
      }
    };
    const req = https.request(options, (res) => {
      if (res.statusCode === 204) {
        console.log(`✅ Workflow disparado para: ${postId}`);
        console.log(`🔗 Acompanhe: https://github.com/${REPO}/actions/workflows/${WORKFLOW}`);
        resolve();
      } else {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          console.error(`❌ Erro ${res.statusCode}: ${d}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        });
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  let postId = process.argv[2];

  if (!postId) {
    postId = detectarPostDoDia();
    if (!postId) {
      const agora = new Date();
      console.log(`⏭️  Nenhum post agendado para agora (${agora.toUTCString()})`);
      console.log('   Use: node postar-agora.js <post-id>');
      process.exit(0);
    }
    console.log(`📅 Post detectado automaticamente: ${postId}`);
  }

  await dispararWorkflow(postId);
})().catch(err => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
