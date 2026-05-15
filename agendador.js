const { chromium } = require('playwright');
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const FormData = require('form-data');

const TOKEN   = 'IGAAN7M86xTEVBZAFpNZAnNZAV21od1N6cUw0Q3d3aEJtZAnZAPOWFZAZAjZAiUjFkcEpRUFRvZAmc0QkdiMWs5UHdWVEszMDdTWUxjUFp0RFJtUnI2MjJtTGg4LVVpMnlXaks2aW5nVG50d2VEd0d4X2ZAMNzg1T3M1OWtKLUZAlYk1qTnhBRQZDZD';
const USER_ID = '17841430730512060';
const BASE    = 'https://graph.instagram.com/v21.0';
const SEMANA  = path.join(__dirname, 'semana1');
const OUTPUT  = path.join(SEMANA, 'output');
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
    if (!el) throw new Error(`Slide #${slideId} não encontrado`);
    await el.screenshot({ path: outFile });
  }
  await page.close();
  return outFile;
}

// ── Hospedar imagem ───────────────────────────────────
async function hospedar(filePath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  return res.data.trim();
}

// ── Criar container Instagram ─────────────────────────
async function criarContainer(imageUrl, tipo, legenda) {
  const params = { image_url: imageUrl, media_type: tipo, access_token: TOKEN };
  if (legenda) params.caption = legenda;
  const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
  return res.data.id;
}

// ── Criar container de carousel ───────────────────────
async function criarCarousel(imageUrls, legenda) {
  // Criar containers filhos
  const children = [];
  for (const url of imageUrls) {
    const res = await axios.post(`${BASE}/${USER_ID}/media`, null, {
      params: { image_url: url, media_type: 'IMAGE', is_carousel_item: true, access_token: TOKEN }
    });
    children.push(res.data.id);
    await new Promise(r => setTimeout(r, 1500));
  }
  // Criar container pai
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

// ── Processar um post ─────────────────────────────────
async function processarPost(post, browser) {
  console.log(`\n📦 ${post.id} — ${post.tipo}`);
  const htmlPath = path.join(SEMANA, post.html);

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
}

// ── AGENDADOR PRINCIPAL ───────────────────────────────
async function iniciarAgendador() {
  const agenda = JSON.parse(fs.readFileSync(path.join(SEMANA, 'agenda.json'), 'utf8'));
  const publicados = new Set();

  console.log(`\n🗓️  SmartGuest Agendador — ${agenda.length} posts na fila\n`);
  agenda.forEach(p => {
    const dt = new Date(p.data);
    console.log(`  • ${p.id} — ${dt.toLocaleDateString('pt-BR')} às ${dt.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}`);
  });
  console.log('\n⏳ Aguardando horários...\n');

  const browser = await chromium.launch();

  const verificar = async () => {
    const agora = new Date();
    for (const post of agenda) {
      if (publicados.has(post.id)) continue;
      const horario = new Date(post.data);
      if (agora >= horario) {
        publicados.add(post.id);
        try {
          await processarPost(post, browser);
        } catch (err) {
          console.error(`  ❌ Erro em ${post.id}:`, err.response?.data || err.message);
        }
      }
    }
    if (publicados.size === agenda.length) {
      console.log('\n🎉 Todos os posts publicados!\n');
      await browser.close();
      clearInterval(timer);
    }
  };

  const timer = setInterval(verificar, 30000); // verifica a cada 30s
  await verificar(); // verifica imediatamente
}

iniciarAgendador().catch(console.error);
