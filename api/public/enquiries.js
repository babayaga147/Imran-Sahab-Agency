// Same-origin proxy for the website's enquiry form.
// Forwards the submission to the Supabase Edge Function, which saves it as a new lead
// for the agency owner so it appears in the manager dashboard.
const ENDPOINT = 'https://apkrskivceowhcazqzwp.supabase.co/functions/v1/submit-enquiry';
const TIMEOUT_MS = 12000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ received: false, error: 'Method not allowed' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* not JSON */ }

    if (data === null || typeof data !== 'object') {
      // Log status and a short snippet of the reply, never the visitor's submission.
      console.error('Enquiry service returned a non-JSON reply:', upstream.status, raw.slice(0, 300));
      return res.status(502).json({ received: false, error: 'The enquiry service returned an invalid response.' });
    }
    if (upstream.status >= 400) console.error('Enquiry service error:', upstream.status, JSON.stringify(data).slice(0, 300));
    return res.status(upstream.status).json(data);
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'timeout' : String((error && error.message) || error);
    console.error('Enquiry forwarding failed:', reason);
    return res.status(502).json({ received: false, error: 'The enquiry service is temporarily unavailable.' });
  } finally {
    clearTimeout(timer);
  }
};
