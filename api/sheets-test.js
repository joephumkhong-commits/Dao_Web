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

async function runDiag(token) {
  const diag = {};
  const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. spreadsheets.get — vérifie l'accès et liste les onglets existants
  console.log('[sheets-test] GET spreadsheets metadata...');
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=spreadsheetId,properties.title,sheets.properties`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  diag.spreadsheetGet = {
    status: metaRes.status,
    spreadsheetId: meta.spreadsheetId,
    title: meta.properties?.title,
    sheets: (meta.sheets || []).map(s => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
    })),
    error: meta.error || null,
  };
  console.log('[sheets-test] spreadsheets.get =>', JSON.stringify(diag.spreadsheetGet));

  if (meta.error) {
    diag.conclusion = 'ERREUR ACCÈS : le service account ne peut pas lire ce spreadsheet. Vérifier les droits.';
    return diag;
  }

  // 2. Vérifier si l'onglet ventes existe déjà
  const existing = (meta.sheets || []).find(s => s.properties.title === 'ventes');
  if (existing) {
    diag.ventesTabExists = true;
    diag.ventesSheetId = existing.properties.sheetId;
    diag.conclusion = 'Onglet ventes déjà présent — pas besoin de création.';
    console.log('[sheets-test] Onglet ventes trouvé, sheetId =', existing.properties.sheetId);
    return diag;
  }

  diag.ventesTabExists = false;
  console.log('[sheets-test] Onglet ventes absent, tentative de création...');

  // 3. batchUpdate/addSheet — tenter la création
  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'ventes' } } }] }),
    }
  );
  const createData = await createRes.json();
  diag.batchUpdateAddSheet = {
    status: createRes.status,
    replies: createData.replies || null,
    error: createData.error || null,
    raw: createData,
  };
  console.log('[sheets-test] batchUpdate/addSheet =>', JSON.stringify(diag.batchUpdateAddSheet));

  if (createData.error) {
    diag.conclusion = `ERREUR CRÉATION : ${createData.error.message} (code ${createData.error.code})`;
    return diag;
  }

  const newSheetId = createData.replies?.[0]?.addSheet?.properties?.sheetId;
  diag.ventesSheetId = newSheetId;

  // 4. Écrire les en-têtes
  const headersRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('ventes!A1')}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ values: [VENTES_HEADERS] }),
    }
  );
  const headersData = await headersRes.json();
  diag.headersWrite = {
    status: headersRes.status,
    error: headersData.error || null,
    updatedRange: headersData.updatedRange || null,
  };
  console.log('[sheets-test] headersWrite =>', JSON.stringify(diag.headersWrite));

  diag.conclusion = headersData.error
    ? `Onglet créé (sheetId=${newSheetId}) mais écriture en-têtes échouée : ${headersData.error.message}`
    : `Onglet ventes créé avec succès (sheetId=${newSheetId})`;

  return diag;
}

async function appendTestRow(token) {
  const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('ventes!A:F')}:append?valueInputOption=USER_ENTERED`;

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

    const diag = await runDiag(token);

    // Si l'accès au spreadsheet échoue ou la création échoue, retourner le diag immédiatement
    if (diag.spreadsheetGet.error || (diag.batchUpdateAddSheet?.error)) {
      res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: diag.conclusion, diag }));
      return;
    }

    const sheetId = diag.ventesSheetId;
    const rowIndex = await appendTestRow(token);
    await deleteRow(token, sheetId, rowIndex);

    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Connexion OK', diag }));
  } catch (err) {
    console.error('[sheets-test]', err.message);
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
