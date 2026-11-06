module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ received: false, error: 'Method not allowed' });
  }

  const endpoint = 'https://imran-sahab-agency-manager-sv7xfj.v2.appdeploy.ai/api/public/enquiries';

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });

    const raw = await upstream.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: 'The enquiry service returned an invalid response.' };
    }

    return res.status(upstream.status).json(data);
  } catch (error) {
    console.error('Enquiry forwarding failed:', error);
    return res.status(502).json({
      received: false,
      error: 'The enquiry service is temporarily unavailable.',
    });
  }
};
