const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const { animal, chiffre, signe, lieu } = req.body || {};
  if (!animal) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing "animal" field' }));
    return;
  }

  const prompt =
    `Fine art premium wall art, portrait format 3:4, deep matte black background, ` +
    `full bleed black, no white space, no frame visible inside.\n` +
    `Centered ultra-realistic intaglio engraving portrait of a ${animal}, ` +
    `black and white only, dramatic chiaroscuro lighting, ` +
    `extreme detail in fur/feathers/scales.\n` +
    `On the forehead of the animal: the astrological symbol ${signe || ''} ` +
    `glowing phosphorescent cyan #00E5FF, neon light effect, sharp and luminous.\n` +
    `Below the animal face, centered: the number ${chiffre || ''} ` +
    `large, glowing phosphorescent cyan #00E5FF, neon effect.\n` +
    `At the very bottom edge: the text "${lieu || ''}" in tiny discreet ` +
    `monospace typography, subtle cyan color, very low opacity.\n` +
    `Overall mood: mystical, luxury, museum-quality dark artwork.\n` +
    `No white background. No realistic photo style. Engraving art style only.`;

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
      const errText = await geminiRes.text();
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Gemini error: ${errText}` }));
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
    res.end(JSON.stringify({ error: err.message }));
  }
};
