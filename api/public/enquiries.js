const ENDPOINT = 'https://imran-sahab-agency-manager-sv7xfj.v2.appdeploy.ai/api/public/enquiries';
const TIMEOUT_MS = 12000;

// Server-to-server call to the manager app. Returns what actually came back,
// without throwing on non-JSON bodies, so failures can be diagnosed.
async function callUpstream(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    const contentType = upstream.headers.get('content-type') || '';
    const headers = {};
    ['server', 'via', 'www-authenticate', 'location', 'x-frame-options', 'cf-ray', 'x-request-id'].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* not JSON */ }
    return { ok: true, status: upstream.status, contentType, headers, raw, data };
  } catch (error) {
    return { ok: false, error: error && error.name === 'AbortError' ? 'timeout' : String(error && error.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  // Temporary wider probe: GET /api/public/enquiries?probe=2
  // Tries harmless variants (honeypot payload only, or plain GET/OPTIONS) to see what the manager app refuses on.
  if (req.method === 'GET' && req.query && String(req.query.probe) === '2') {
    const base = 'https://imran-sahab-agency-manager-sv7xfj.v2.appdeploy.ai';
    const me = 'https://imransahabagency.vercel.app';
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const post = { method: 'POST', body: JSON.stringify({ website: 'probe' }) };
    const variants = {
      a_post_default: [base + '/api/public/enquiries', { ...post, headers: { 'Content-Type': 'application/json' } }],
      b_post_origin_referer_manager: [base + '/api/public/enquiries', { ...post, headers: { 'Content-Type': 'application/json', Origin: base, Referer: base + '/' } }],
      c_post_browser_ua_origin_site: [base + '/api/public/enquiries', { ...post, headers: { 'Content-Type': 'application/json', 'User-Agent': ua, Accept: '*/*', Origin: me, Referer: me + '/' } }],
      d_get_root: [base + '/', { method: 'GET', headers: { 'User-Agent': ua } }],
      e_get_enquiries: [base + '/api/public/enquiries', { method: 'GET', headers: { 'User-Agent': ua } }],
      f_options_preflight: [base + '/api/public/enquiries', { method: 'OPTIONS', headers: { Origin: me, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }],
    };
    const out = {};
    await Promise.all(Object.entries(variants).map(async ([k, [url, opts]]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const u = await fetch(url, { ...opts, signal: controller.signal });
        const raw = await u.text();
        out[k] = {
          status: u.status,
          contentType: u.headers.get('content-type') || '',
          server: u.headers.get('server') || '',
          acao: u.headers.get('access-control-allow-origin') || '',
          text: raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
        };
      } catch (e) {
        out[k] = { error: e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e) };
      } finally {
        clearTimeout(timer);
      }
    }));
    return res.status(200).json({ probe: 2, results: out });
  }

  // Temporary health probe: GET /api/public/enquiries?probe=1
  // Sends the honeypot payload, which the manager app ignores without saving anything,
  // and reports exactly what the manager app returned. Remove once the form is confirmed working.
  if (req.method === 'GET' && req.query && req.query.probe) {
    const r = await callUpstream({ website: 'probe' });
    if (!r.ok) return res.status(200).json({ probe: true, reachedUpstream: false, error: r.error });
    return res.status(200).json({
      probe: true,
      reachedUpstream: true,
      upstreamStatus: r.status,
      upstreamContentType: r.contentType,
      isJson: r.data !== null,
      jsonKeys: r.data && typeof r.data === 'object' ? Object.keys(r.data) : null,
      received: r.data ? r.data.received : undefined,
      upstreamHeaders: r.headers,
      bodyText: r.raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ received: false, error: 'Method not allowed' });
  }

  const r = await callUpstream(req.body || {});

  if (!r.ok) {
    console.error('Enquiry forwarding failed:', r.error);
    return res.status(502).json({ received: false, error: 'The enquiry service is temporarily unavailable.', reason: r.error });
  }

  if (r.data === null) {
    // Log status and a short snippet of the upstream reply (never the visitor's submission).
    console.error('Enquiry service returned a non-JSON reply:', r.status, r.contentType, r.raw.slice(0, 300));
    return res.status(502).json({
      received: false,
      error: 'The enquiry service returned an invalid response.',
      upstreamStatus: r.status,
      upstreamContentType: r.contentType,
    });
  }

  if (r.status >= 400) console.error('Enquiry service error:', r.status, JSON.stringify(r.data).slice(0, 300));
  return res.status(r.status).json(r.data);
};
