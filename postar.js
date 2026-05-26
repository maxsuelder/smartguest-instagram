/**
 * postar.js — Publica um post específico da agenda no Instagram
 * Uso: node postar.js <post-id>
 * Ex:  node postar.js sex16-story-tempo
 */

const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const FormData = require('form-data');

let   TOKEN   = process.env.INSTAGRAM_TOKEN;
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

// ── Retry com backoff exponencial ────────────────────
async function comRetry(fn, tentativas = 3, label = '') {
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const code = err.response?.data?.error?.code;
      console.warn(`  ⚠️  ${label} — tentativa ${i}/${tentativas}: ${msg}`);
      if (i === tentativas) throw err;
      // Não retentar erros de autenticação
      if (code === 190 || code === 200) throw err;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

// ── Auto-renovação do token ───────────────────────────
async function renovarToken() {
  try {
    const res = await axios.get(`${BASE}/refresh_access_token`, {
      params: { grant_type: 'ig_refresh_token', access_token: TOKEN }
    });
    if (res.data.access_token && res.data.access_token !== TOKEN) {
      TOKEN = res.data.access_token;
      console.log(`  🔄 Token renovado (válido por ${Math.round(res.data.expires_in/86400)} dias)`);
    }
  } catch (e) {
    console.warn(`  ⚠️  Não foi possível renovar token: ${e.message}`);
  }
}

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

// ── Converter PNG → MP4 (Reels) ──────────────────────
function converterParaVideo(pngFile, mp4File) {
  // Vídeo estático 9s com efeito Ken Burns suave (zoom in lento)
  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${pngFile}"`,
    `-c:v libx264 -t 9`,
    `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0008,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=270:s=1080x1920"`,
    `-pix_fmt yuv420p -movflags +faststart`,
    `"${mp4File}"`
  ].join(' ');
  execSync(cmd, { stdio: 'pipe' });
}

// ── Hospedar vídeo via GitHub Releases ───────────────
async function hospedarVideo(filePath, postId) {
  const ghToken = process.env.GITHUB_TOKEN;
  const owner   = 'maxsuelder';
  const repo    = 'smartguest-instagram';
  const tag     = 'media-assets';
  const fname   = `${postId}.mp4`;
  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 1. Pega ou cria a release "media-assets"
  let releaseId;
  try {
    const r = await axios.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers: ghHeaders });
    releaseId = r.data.id;
    // Apaga asset anterior com mesmo nome (se existir)
    const existing = r.data.assets.find(a => a.name === fname);
    if (existing) {
      await axios.delete(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`, { headers: ghHeaders });
    }
  } catch (e) {
    const r = await axios.post(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      tag_name: tag, name: 'Media Assets', body: 'Hospedagem temporária de vídeos para Instagram', draft: false, prerelease: true
    }, { headers: ghHeaders });
    releaseId = r.data.id;
  }

  // 2. Faz upload do MP4
  const uploadRes = await axios.post(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${fname}`,
    fs.readFileSync(filePath),
    { headers: { ...ghHeaders, 'Content-Type': 'video/mp4' }, maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 }
  );
  const url = uploadRes.data.browser_download_url;
  console.log(`  ☁️  GitHub Release OK: ${url}`);
  return url;
}

// ── Criar container Reels ─────────────────────────────
async function criarContainerReels(videoUrl, legenda) {
  return comRetry(async () => {
    const params = { video_url: videoUrl, media_type: 'REELS', access_token: TOKEN };
    if (legenda) params.caption = legenda;
    const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
    return res.data.id;
  }, 3, 'criarContainerReels');
}

// ── Aguardar processamento do vídeo ───────────────────
async function aguardarProcessamento(containerId, max = 20) {
  for (let i = 0; i < max; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res = await axios.get(`${BASE}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: TOKEN }
    });
    const status = res.data.status_code;
    console.log(`  ⏳ Processando vídeo: ${status} (${i + 1}/${max})`);
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(`Erro no processamento: ${JSON.stringify(res.data.status)}`);
  }
  throw new Error('Timeout: vídeo não processou a tempo');
}

// ── Criar container Instagram ─────────────────────────
async function criarContainer(imageUrl, tipo, legenda) {
  return comRetry(async () => {
    const params = { image_url: imageUrl, media_type: tipo, access_token: TOKEN };
    if (legenda) params.caption = legenda;
    const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
    return res.data.id;
  }, 3, 'criarContainer');
}

// ── Criar container carousel ──────────────────────────
async function criarCarousel(imageUrls, legenda) {
  const children = [];
  for (const url of imageUrls) {
    const id = await comRetry(async () => {
      const res = await axios.post(`${BASE}/${USER_ID}/media`, null, {
        params: { image_url: url, media_type: 'IMAGE', is_carousel_item: true, access_token: TOKEN }
      });
      return res.data.id;
    }, 3, 'criarItemCarousel');
    children.push(id);
    await new Promise(r => setTimeout(r, 1500));
  }
  return comRetry(async () => {
    const params = { media_type: 'CAROUSEL', children: children.join(','), access_token: TOKEN };
    if (legenda) params.caption = legenda;
    const res = await axios.post(`${BASE}/${USER_ID}/media`, null, { params });
    return res.data.id;
  }, 3, 'criarContainerCarousel');
}

// ── Publicar ──────────────────────────────────────────
async function publicar(containerId) {
  await new Promise(r => setTimeout(r, 5000));
  return comRetry(async () => {
    const res = await axios.post(`${BASE}/${USER_ID}/media_publish`, null, {
      params: { creation_id: containerId, access_token: TOKEN }
    });
    return res.data.id;
  }, 3, 'publicar');
}

// ── Principal ─────────────────────────────────────────
(async () => {
  // Busca semana com agenda.json
  // Renovar token antes de publicar
  await renovarToken();

  const semanas = ['semana1', 'semana2', 'semana3', 'semana4', 'semana5', 'semana6', 'semana-ia', 'semana-maio', 'posts-especiais/neymar-copa'];
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
    if (post.tipo === 'REELS') {
      const pngFile = path.join(OUTPUT, `${post.id}.png`);
      const mp4File = path.join(OUTPUT, `${post.id}.mp4`);

      // 1. Screenshot
      await exportarSlide(browser, htmlPath, post.slide || 'body', pngFile, post.largura, post.altura);
      console.log(`  📸 Screenshot exportado`);

      // 2. Converter PNG → MP4
      console.log(`  🎬 Convertendo para MP4...`);
      converterParaVideo(pngFile, mp4File);
      console.log(`  🎬 MP4 gerado (${Math.round(fs.statSync(mp4File).size / 1024)}kb)`);

      // 3. Hospedar vídeo
      const videoUrl = await hospedarVideo(mp4File, post.id);

      // 4. Criar container Reels
      const cid = await criarContainerReels(videoUrl, post.legenda);
      console.log(`  📦 Container Reels: ${cid}`);

      // 5. Aguardar processamento pelo Instagram
      await aguardarProcessamento(cid);
      console.log(`  ✅ Vídeo processado`);

      // 6. Publicar
      const mid = await publicar(cid);
      console.log(`  ✅ Reels publicado! ID: ${mid}`);

    } else if (post.tipo === 'STORIES' || post.tipo === 'IMAGE') {
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
