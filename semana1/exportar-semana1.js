const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE   = path.join(__dirname);
const OUTPUT = path.join(BASE, 'output');
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

const posts = [
  {
    id: 'sex16-story-tempo',
    html: path.join(BASE, 'SEX 16mai - Story Tempo Perdido', 'story-tempo-perdido.html'),
    w: 1080, h: 1920, slides: ['body']
  },
  {
    id: 'sab17-story-bastidores',
    html: path.join(BASE, 'SAB 17mai - Story Bastidores', 'story-bastidores.html'),
    w: 1080, h: 1920, slides: ['body']
  },
  {
    id: 'seg19-carousel-sinais',
    html: path.join(BASE, 'SEG 19mai - Carousel 5 Sinais', 'carousel-5-sinais.html'),
    w: 1080, h: 1080, slides: ['s1','s2','s3','s4','s5','s6','s7']
  },
  {
    id: 'qua21-story-planilha',
    html: path.join(BASE, 'QUA 21mai - Story Planilha', 'story-planilha.html'),
    w: 1080, h: 1920, slides: ['body']
  },
  {
    id: 'qui22-carousel-duplicada',
    html: path.join(BASE, 'QUI 22mai - Carousel Reserva Duplicada', 'carousel-reserva-duplicada.html'),
    w: 1080, h: 1080, slides: ['s1','s2','s3','s4','s5','s6']
  }
];

(async () => {
  console.log('\n🚀 Exportando Semana 1...\n');
  const browser = await chromium.launch();

  for (const post of posts) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: post.w, height: post.h });
    await page.goto(`file:///${post.html}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    for (let i = 0; i < post.slides.length; i++) {
      const slideId = post.slides[i];
      const num = post.slides.length > 1 ? `slide${String(i+1).padStart(2,'0')}` : 'img';
      const outFile = path.join(OUTPUT, `${post.id}-${num}.png`);

      if (slideId === 'body') {
        await page.screenshot({ path: outFile });
      } else {
        const el = await page.$(`#${slideId}`);
        if (el) await el.screenshot({ path: outFile });
      }
      console.log(`  ✅ ${path.basename(outFile)}`);
    }
    await page.close();
  }

  await browser.close();
  console.log('\n✅ Exportação completa! Pasta: semana1/output/\n');
})();
