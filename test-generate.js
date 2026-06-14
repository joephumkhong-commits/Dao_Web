const fs = require('fs');
const path = require('path');

// Charge les variables depuis .env.local sans dépendance externe
const envFile = path.join(__dirname, '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?([^"'\n]*)["']?/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const animal  = 'ours';
const chiffre = '33';
const signe   = 'Poissons';
const safeLieu = 'ANNECY FRANCE';

const prompt = `You are generating a photorealistic product image of a DAÖ artwork.

STRICT RULES:
- Physical 3D printed sculpture inside a black wooden frame
- NO text, NO numbers, NO symbols, NO floating elements anywhere
- Style: dark luxury product photography, museum artifact quality

FRAME:
A real black wooden frame, portrait orientation,
matte black interior background, subtle gloss on frame edges only.

ANIMAL (centered, upper 60% of the frame):
A ${animal} head — low-poly geometric style,
exactly like a physical 3D printed trophy,
dark gray matte PLA texture, polygon facets clearly visible,
dramatic single top-down spotlight, deep shadows between facets,
no fur, no realism, no cartoon, no painting.

COMPOSITION:
- Animal bust centered, occupying the upper 60% of the frame
- Lower 40% of frame: pure black, completely empty, reserved
- Pure black background, no gradients, no glow, no texture

PHOTOGRAPHY:
Photorealistic studio shot, single overhead spotlight,
dark dramatic shadows, premium collectible object,
shot on black velvet surface, 8K macro lens`;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY manquante'); process.exit(1); }

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

console.log('Génération en cours… (peut prendre 20-40s)');

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }),
})
.then(r => r.json())
.then(data => {
  const img = data?.candidates?.[0]?.content?.parts?.find(
    p => p.inlineData?.mimeType?.startsWith('image/')
  );
  if (!img) {
    console.error('Pas d\'image dans la réponse:', JSON.stringify(data).slice(0, 400));
    return;
  }
  const { mimeType, data: b64 } = img.inlineData;
  const ext = mimeType.split('/')[1] || 'png';
  const outPath = `/tmp/dao-ours-test.${ext}`;
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`✓ Image sauvée : ${outPath}`);
  console.log(`  Format MIME  : ${mimeType}`);
  const buf = Buffer.from(b64, 'base64');
  console.log(`  Taille fichier : ${(buf.length / 1024).toFixed(1)} KB`);

  // Lecture dimensions PNG depuis les headers IHDR
  if (mimeType === 'image/png') {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    console.log(`  Dimensions : ${w} x ${h} px  (ratio ${(h/w).toFixed(3)} — attendu 1.333 pour 3:4)`);
    console.log(`  Ratio 3:4 appliqué : ${Math.abs(h/w - 4/3) < 0.01 ? '✓ OUI' : '✗ NON (ratio libre)'}`);
  }
})
.catch(err => console.error('Erreur fetch:', err.message));
