const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://mydao.fr',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT = 3;
const RATE_WINDOW = 60 * 1000;
const ipMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const times = (ipMap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (times.length >= RATE_LIMIT) return true;
  ipMap.set(ip, [...times, now]);
  return false;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    res.writeHead(429, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Trop de requêtes. Attends une minute avant de réessayer.' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const VALID_ANIMALS = ['cheval','cerf','sanglier','loup','ours','aigle','serpent','cygne','chat','taureau','corbeau','renard'];
  const { animal, chiffre, signe, lieu } = req.body || {};
  if (!animal || !VALID_ANIMALS.includes(animal)) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Paramètre invalide.' }));
    return;
  }

  const fond = req.body.fond || 'noir';
  const safeLieu = (lieu || '').slice(0, 13).replace(/["\\\n\r]/g, '');

  const prompt =
    `Low-poly geometric ${animal} head, wall mounted trophy style, ` +
    `flat angular faces, smooth matte black sculpture, ` +
    `zero texture zero fur zero realism, ` +
    `pure geometric polygons only, sharp edges between flat faces, ` +
    `modern minimalist trophy mount, luxury wall art, ` +
    `centered on ${fond === 'noir' ? 'pure solid black' : 'pure solid white'} background, ` +
    `no gradient no shadow on background, ` +
    `portrait orientation 3:4 ratio, ` +
    `thick ${fond === 'noir' ? 'black' : 'white'} frame border, ` +
    `dramatic side studio lighting to reveal polygon facets, ` +
    `cyan neon glow ${signe || ''} symbol small on forehead, ` +
    `cyan neon number ${chiffre || ''} bottom center large, ` +
    `tiny white text '${safeLieu}' very bottom very small opacity 40%, ` +
    `photorealistic render of a physical sculpture, ` +
    `no illustration style, no cartoon, no watercolor, ` +
    `EXACT same geometric style as a low-poly 3D printed trophy head`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }));
    return;
  }

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.5-flash-image:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });

    if (!geminiRes.ok) {
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'La génération a échoué. Réessaie dans un instant.' }));
      return;
    }

    const data = await geminiRes.json();
    const imagePart = data?.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.mimeType?.startsWith('image/')
    );

    if (!imagePart) {
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No image returned by Gemini' }));
      return;
    }

    const { mimeType, data: b64 } = imagePart.inlineData;
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ image: `data:${mimeType};base64,${b64}` }));
  } catch (err) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Erreur serveur inattendue. Réessaie.' }));
  }
};
