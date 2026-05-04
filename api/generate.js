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
    `Premium luxury wall art in a thick black frame, portrait format 3:4.\n` +
    `Deep matte black background inside the frame.\n` +
    `A hyper-realistic 3D sculpture of a ${animal} head, ` +
    `appearing to emerge from the black background in relief, ` +
    `like a trophy mount or epoxy resin 3D art piece.\n` +
    `The sculpture is black and dark grey, highly detailed, ` +
    `with dramatic studio lighting creating strong depth and shadows.\n` +
    `On the forehead of the ${animal}: the astrological symbol ${signe || ''} ` +
    `glowing phosphorescent cyan #00E5FF, neon effect, sharp and luminous.\n` +
    `Below the animal face, centered in the lower third: ` +
    `the number ${chiffre || ''} large, glowing phosphorescent cyan #00E5FF, neon effect.\n` +
    `At the very bottom: the text "${lieu || ''}" in tiny monospace typography, ` +
    `subtle cyan, very low opacity.\n` +
    `The thick black frame has a subtle glossy reflection.\n` +
    `Overall: mystical, luxury, 3D epoxy resin art, museum-quality.`;

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
