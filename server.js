const express = require('express');
const { neon } = require('@neondatabase/serverless');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const sql = neon(process.env.DATABASE_URL);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Landing pages — reads from platform DB
app.get('/l/:slug', async (req, res) => {
  try {
    const [company] = await sql`
      SELECT landing_page_html FROM companies WHERE slug = ${req.params.slug}
    `;
    if (!company || !company.landing_page_html) {
      return res.status(404).send('Page not found');
    }
    // Inject checkout handler for [data-checkout="true"] buttons
    const checkoutScript = `<script>
document.querySelectorAll('[data-checkout="true"]').forEach(function(el) {
  el.addEventListener('click', async function(e) {
    e.preventDefault();
    var original = el.innerHTML;
    if (el.tagName === 'BUTTON') el.disabled = true;
    el.textContent = 'Loading...';
    try {
      var r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      var data = await r.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Checkout failed. Please try again.');
        el.innerHTML = original;
        if (el.tagName === 'BUTTON') el.disabled = false;
      }
    } catch(err) {
      alert('Something went wrong. Please try again.');
      el.innerHTML = original;
      if (el.tagName === 'BUTTON') el.disabled = false;
    }
  });
});
<\/script>`;
    const html = company.landing_page_html.replace('</body>', checkoutScript + '\n</body>');
    res.send(html);
  } catch (err) {
    console.error('Landing page error:', err);
    res.status(500).send('Error loading page');
  }
});

// Stripe Checkout — $2 one-time payment
app.post('/api/checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID || 'price_1TBBgn4Ho2w0775bfVtMOc2U',
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/l/consultr`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

// Success page — shown after payment, redirects back to landing page
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (session_id) {
    try {
      await stripe.checkout.sessions.retrieve(session_id);
    } catch (err) {
      console.error('Session retrieval error:', err);
    }
  }
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Consultr!</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <meta http-equiv="refresh" content="5;url=/l/consultr">
</head>
<body class="min-h-screen flex items-center justify-center" style="background:linear-gradient(160deg,#f0f7ff 0%,#e8f0fe 40%,#f8fafc 100%)">
  <div class="text-center p-8 max-w-md">
    <div style="font-size:64px;margin-bottom:16px;">🎉</div>
    <h1 style="font-size:28px;font-weight:900;color:#1a2332;margin-bottom:12px;letter-spacing:-0.5px;">You're a founding member!</h1>
    <p style="color:#64748b;font-size:16px;line-height:1.6;margin-bottom:8px;">Welcome to Consultr. Your $2 founding access is confirmed.</p>
    <p style="color:#94a3b8;font-size:13px;margin-bottom:28px;">Redirecting you back in 5 seconds...</p>
    <a href="/l/consultr" style="display:inline-block;background:#F59E0B;color:#1a2332;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;">Back to Consultr →</a>
  </div>
</body>
</html>`);
});

// Cancel — redirect back to landing page
app.get('/cancel', (req, res) => {
  res.redirect('/l/consultr');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Consultr server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  process.exit(0);
});
