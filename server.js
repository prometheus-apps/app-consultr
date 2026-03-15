const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe — only initialise if key is present
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root → landing page
app.get('/', (req, res) => {
  res.redirect('/l/consultr');
});

// Landing page
app.get('/l/consultr', (req, res) => {
  try {
    let html = fs.readFileSync(
      path.join(__dirname, 'views', 'landing-consultr.html'),
      'utf8'
    );

    // Show success banner after payment
    if (req.query.purchased === 'true') {
      const banner = '<div style="background:#4ade80;color:#14532d;text-align:center;padding:14px 24px;font-weight:700;font-size:15px;">\uD83C\uDF89 Welcome to Consultr! Your founding member access is confirmed. We\'ll be in touch shortly.</div>';
      html = html.replace('<body>', '<body>' + banner);
    }

    res.send(html);
  } catch (err) {
    console.error('Error serving landing page:', err);
    res.status(500).send('Error loading page');
  }
});

// Stripe checkout — creates session and returns URL
app.post('/api/checkout', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Payment not configured' });
  }
  try {
    const priceId = process.env.STRIPE_PRICE_ID || 'price_1TAYLE4Ho2w0775bgWDBUTtw';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

// Success — verify payment and redirect back to landing page
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (session_id && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      console.log('Payment confirmed:', session.id, session.customer_email, session.amount_total);
    } catch (err) {
      console.error('Session retrieval error:', err);
    }
  }
  res.redirect('/l/consultr?purchased=true');
});

// Cancel — return to landing page
app.get('/cancel', (req, res) => {
  res.redirect('/l/consultr');
});

// ── Error Handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Consultr server running on port ${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
