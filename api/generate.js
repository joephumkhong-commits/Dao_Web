const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

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
    `Generate a luxury wall art product photo in a black IKEA frame.\n` +
    `Low-poly geometric ${animal} head sculpture, matte dark grey, ` +
    `centered on pure black background. Number ${chiffre || ''} glowing ` +
    `cyan #00FFB2 engraved on forehead. ${signe || ''} constellation in ` +
    `cyan glowing dots below. GPS coordinates '${lieu || ''}' in small ` +
    `monospace font at bottom. 4-pointed white star bottom right.\n` +
    `Dark studio lighting, museum quality, sharp focus.\n` +
    `Use this image as the exact style reference. ` +
    `Match the frame, lighting, darkness level, and overall aesthetic precisely. ` +
    `Only change the animal head, the number on the forehead, ` +
    `and the constellation symbol.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }));
    return;
  }

  const refImagePath = path.join(__dirname, '..', 'images', 'dao-reference.png');
  const refBuffer = await sharp(fs.readFileSync(refImagePath))
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const refBase64 = refBuffer.toString('base64');

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.5-flash-image:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: refBase64,
              },
            },
            { text: prompt },
          ],
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
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
