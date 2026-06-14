const { webcrypto } = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;
const ipMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const times = (ipMap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (times.length >= RATE_LIMIT) return true;
  ipMap.set(ip, [...times, now]);
  return false;
}

const SHEET_ID = '1-Y37eX_WI19AUWxF08Je9V0Y0q1DvKFkAdiUBu0G03c';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const TAB_HEADERS = {
  leads:  ['Timestamp', 'Prénom', 'Email', 'Totem', 'Signe astro', 'Chiffre de vie', 'MBTI lié', 'Source'],
  ventes: ['Timestamp', 'Client', 'Email', 'Téléphone', 'Tableau', 'Montant (€)', 'Date vente', 'Ajouté par'],
};

function b64url(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function getAccessToken(privateKeyPem, clientEmail) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const unsigned = `${header}.${payload}`;

  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const cryptoKey = await webcrypto.subtle.importKey(
    'pkcs8',
    Buffer.from(pemBody, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned)
  );

  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function ensureTab(token, tab) {
  const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab + '!A1')}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const checkData = await checkRes.json();
  if (!checkData.error) return;

  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    }
  );
  const createData = await createRes.json();
  if (createData.error && !createData.error.message.includes('already exists')) {
    throw new Error('Tab creation error: ' + JSON.stringify(createData.error));
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ values: [TAB_HEADERS[tab]] }),
    }
  );
}

async function appendToSheet(token, tab, values) {
  const range = `${tab}!A:H`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Sheets API error: ${detail}`);
  }
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
    res.end(JSON.stringify({ error: 'Trop de requêtes. Attends une minute.' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const credsRaw = process.env.GOOGLE_CREDENTIALS;
  if (!credsRaw) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GOOGLE_CREDENTIALS not configured' }));
    return;
  }

  const { type } = req.body || {};

  if (type !== 'lead' && type !== 'vente') {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Champ "type" requis : "lead" ou "vente"' }));
    return;
  }

  try {
    const creds = JSON.parse(credsRaw);
    const token = await getAccessToken(creds.private_key, creds.client_email);
    const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    if (type === 'lead') {
      const { prenom, email, totem, signe_astro, life_number, mbti_linked, source } = req.body;

      if (!email) {
        res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email requis pour un lead.' }));
        return;
      }

      await ensureTab(token, 'leads');
      await appendToSheet(token, 'leads', [
        timestamp,
        prenom || '',
        email || '',
        totem || '',
        signe_astro || '',
        String(life_number ?? ''),
        mbti_linked || '',
        source || '',
      ]);
    } else {
      const { client, email, telephone, tableau, montant, date_vente, ajoute_par } = req.body;

      if (!client || !montant) {
        res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Champs "client" et "montant" requis pour une vente.' }));
        return;
      }

      await ensureTab(token, 'ventes');
      await appendToSheet(token, 'ventes', [
        timestamp,
        client || '',
        email || '',
        telephone || '',
        tableau || '',
        String(montant ?? ''),
        date_vente || '',
        ajoute_par || '',
      ]);
    }

    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    console.error('[sheets]', err.message);
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Erreur serveur. Réessaie.' }));
  }
};
