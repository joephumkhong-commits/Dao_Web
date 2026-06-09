const { webcrypto } = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SHEET_ID = '1-Y37eX_WI19AUWxF08Je9V0Y0q1DvKFkAdiUBu0G03c';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const VENTES_HEADERS = ['Timestamp', 'Client', 'Tableau', 'Montant (€)', 'Date vente', 'Ajouté par'];

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

  const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(unsigned));
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

async function ensureVentesTabAndGetId(token) {
  const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Ventes!A1')}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const checkData = await checkRes.json();

  if (!checkData.error) {
    // Tab already exists — fetch its sheetId by title
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    const sheet = (meta.sheets || []).find(s => s.properties.title === 'Ventes');
    if (!sheet) throw new Error('Onglet "Ventes" introuvable');
    return sheet.properties.sheetId;
  }

  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Ventes' } } }] }),
    }
  );
  const createData = await createRes.json();

  if (createData.error) {
    if (createData.error.message.includes('already exists')) {
      // Race condition : l'onglet existe déjà, on récupère son id via l'API
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const meta = await metaRes.json();
      const sheet = (meta.sheets || []).find(s => s.properties.title === 'Ventes');
      if (!sheet) throw new Error('Onglet "Ventes" introuvable');
      return sheet.properties.sheetId;
    }
    throw new Error('Tab creation error: ' + JSON.stringify(createData.error));
  }

  // Utilise directement le sheetId retourné par addSheet — pas de délai de propagation
  const sheetId = createData.replies[0].addSheet.properties.sheetId;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Ventes!A1')}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ values: [VENTES_HEADERS] }),
    }
  );

  return sheetId;
}

async function appendTestRow(token) {
  const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Ventes!A:F')}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[timestamp, '[TEST]', 'sheets-test', '0', timestamp, 'Système']] }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Append error: ' + detail);
  }

  const data = await res.json();
  const updatedRange = data.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  if (!match) throw new Error('Impossible de lire la ligne écrite : ' + updatedRange);
  return parseInt(match[1]) - 1; // 0-based row index
}

async function deleteRow(token, sheetId, rowIndex) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
          },
        }],
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Delete row error: ' + detail);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    return;
  }

  const credsRaw = process.env.GOOGLE_CREDENTIALS;
  if (!credsRaw) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'GOOGLE_CREDENTIALS not configured' }));
    return;
  }

  try {
    const creds = JSON.parse(credsRaw);
    const token = await getAccessToken(creds.private_key, creds.client_email);

    const sheetId = await ensureVentesTabAndGetId(token);
    const rowIndex = await appendTestRow(token);
    await deleteRow(token, sheetId, rowIndex);

    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Connexion OK' }));
  } catch (err) {
    console.error('[sheets-test]', err.message);
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
