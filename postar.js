/**
 * postar.js — Publica um post específico da agenda no Instagram
 * Uso: node postar.js <post-id>
 * Ex:  node postar.js sex16-story-tempo
 */

const { chromium } = require('playwright');
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const FormData = require('form-data');

const TOKEN   = process.env.INSTAGRAM_TOKEN;
const USER_ID = process.env.INSTAGRAM_USER_ID;
const BASE    = 'https://graph.instagram.com/v21.0';

if (!TOKEN || !USER_ID) {
  console.error('❌ INSTAGRAM_TOKEN e INSTAGRAM_USER_ID devem estar definidos como variáveis de ambiente.');
  process.exit(1);
}

const POST_ID = process.argv[2];
if (!POST_ID) {
  console.error('❌ Informe o ID do post: node postar.js <post-id>');
  process.exit(1);
}

// ── Pasta de saída temporária ─────────────────────────
const OUTPUT = path.join(__dirname, 'tmp_output');
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

// ── Exportar PNG de um slide ──────────────────────────
async function exportarSlide(browser, htmlFile, slideId, outFile, w, h) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`file:///${htmlFile}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  if (slideId === 'body') {
    await page.screenshot({ path: outFile });
  } else {
    const el = await page.$(`#${slideId}`);
    if (!el) throw new Error(`Slide #${slideId} não encontrado em ${htmlFile}`);
    await el.screenshot({ path: outFile });
  }
  await page.close();
  return outFile;
}

// ── Hospedar imagem (ImgBB → tmpfiles → catbox fallback) ─
async function hospedar(filePath) {
  // 1. ImgBB (recomendado, funciona em servidores CI)
  if (process.env.IMGBB_KEY) {
    try {
      const form = new FormData();
      form.append('image', fs.readFileSync(filePath).toString('base64'));
      const res = await axios.post(
        `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`,
        form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
      );
      const url = res.data.data.url;
      if (url && url.startsWith('http')) return url;
    } catch (e) { console.log(`  ⚠️ ImgBB falhou: ${e.message}`); }
  }

  // 2. tmpfiles.org (fallback)
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    const url = res.data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    if (url && url.startsWith('http')) return url;
  } catch (e) { console.log(`  ⚠️ tmpfiles falhou: ${e.message}`); }

  // 3. catbox.moe (último recurso — pode falhar em CI)
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath));
    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    const url = res.data.trim();
    if (url && url.startsWith('http')) return url;
  } catch (e) { console.log(`  ⚠️ Catbox falhou: ${e.message}`); }

  throw new Error('Todos os serviços de hospedagem falharam');
}

// ── Criar container Instagram ─────────────────────────
async function criarContainer(imageUrl, tipo, legenda) {
  const params = { image_url: imageUrl, media_type: tipo, access_token: TOKEN };
  if (legenda) params.caption = legenda;
  const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
  return res.data.id;
}

// ── Criar container carousel ──────────────────────────
async function criarCarousel(imageUrls, legenda) {
  const children = [];
  for (const url of imageUrls) {
    const res = await axios.post(`${BASE}/${USER_ID}/media`, null, {
      params: { image_url: url, media_type: 'IMAGE', is_carousel_item: true, access_token: TOKEN }
    });
    children.push(res.data.id);
    await new Promise(r => setTimeout(r, 1500));
  }
  const params = { media_type: 'CAROUSEL', children: children.join(','), access_token: TOKEN };
  if (legenda) params.caption = legenda;
  const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
  return res.data.id;
}

// ── Publicar ──────────────────────────────────────────
async function publicar(containerId) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await axios.post(`${BASE}/${USER_ID}/media_publish`, null, {
    params: { creation_id: containerId, access_token: TOKEN }
  });
  return res.data.id;
}

// ── Principal ─────────────────────────────────────────
(async () => {
  // Busca semana com agenda.json
  const semanas = ['semana1', 'semana2', 'semana3', 'semana4', 'semana-ia'];
  let post = null;
  let semanaDir = null;

  for (const s of semanas) {
    const agendaPath = path.join(__dirname, s, 'agenda.json');
    if (!fs.existsSync(agendaPath)) continue;
    const agenda = JSON.parse(fs.readFileSync(agendaPath, 'utf8'));
    const found = agenda.find(p => p.id === POST_ID);
    if (found) { post = found; semanaDir = path.join(__dirname, s); break; }
  }

  if (!post) {
    console.error(`❌ Post '${POST_ID}' não encontrado em nenhuma agenda.json`);
    process.exit(1);
  }

  console.log(`\n🚀 Publicando: ${post.id} (${post.tipo})\n`);
  const htmlPath = path.join(semanaDir, post.html);
  const browser  = await chromium.launch();

  try {
    if (post.tipo === 'STORIES' || post.tipo === 'IMAGE') {
      const outFile = path.join(OUTPUT, `${post.id}.png`);
      await exportarSlide(browser, htmlPath, post.slide || 'body', outFile, post.largura, post.altura);
      console.log(`  📸 PNG exportado`);
      const url = await hospedar(outFile);
      console.log(`  ☁️  Hospedado: ${url}`);
      const cid = await criarContainer(url, post.tipo, post.legenda);
      console.log(`  📦 Container: ${cid}`);
      const mid = await publicar(cid);
      console.log(`  ✅ Publicado! ID: ${mid}`);

    } else if (post.tipo === 'CAROUSEL') {
      const urls = [];
      for (let i = 0; i < post.slides.length; i++) {
        const outFile = path.join(OUTPUT, `${post.id}-slide${String(i+1).padStart(2,'0')}.png`);
        await exportarSlide(browser, htmlPath, post.slides[i], outFile, post.largura, post.altura);
        const url = await hospedar(outFile);
        urls.push(url);
        console.log(`  ☁️  Slide ${i+1}: ${url}`);
      }
      const cid = await criarCarousel(urls, post.legenda);
      console.log(`  📦 Container carousel: ${cid}`);
      const mid = await publicar(cid);
      console.log(`  ✅ Carousel publicado! ID: ${mid}`);
    }
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('❌ Erro fatal:', err.response?.data || err.message);
  process.exit(1);
});
