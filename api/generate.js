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
    `Generate a new version of this wall art with these changes:\n` +
    `- Replace the animal totem with a ${animal} head, same low-poly geometric 3D style, same dark grey matte finish\n` +
    `- Replace the number on the forehead with ${chiffre || ''} in the same glowing cyan #00FFB2 style\n` +
    `- Replace the astrological symbol with ${signe || ''} constellation in the same cyan glowing dots style\n` +
    `- Replace the coordinates text with '${lieu || ''}'\n` +
    `- Keep everything else identical: black frame, black background, star bottom right, same lighting, same composition`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }));
    return;
  }

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
          ],
        }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
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

    const { mimeType, data: b64out } = imagePart.inlineData;
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ image: `data:${mimeType};base64,${b64out}` }));
  } catch (err) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};
