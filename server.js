const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const sql = neon(process.env.DATABASE_URL);

// ── Middleware ──────────────────────────────────────────────
// Webhook route needs raw body — must be before express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Payment completed:', session.id, session.customer_email);
    try {
      await sql`
        INSERT INTO orders (email, stripe_session_id, status, total_cents)
        VALUES (${session.customer_email || ''}, ${session.id}, 'completed', ${session.amount_total || 200})
        ON CONFLICT (stripe_session_id) DO NOTHING
      `;
    } catch (e) {
      console.error('Order save error:', e);
    }
  }
  res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DB Migration ───────────────────────────────────────────
async function initDB() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL DEFAULT '',
        stripe_session_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        total_cents INTEGER DEFAULT 200,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('Database initialized');
  } catch (err) {
    console.error('DB init failed:', err);
  }
}

// ── Routes ─────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root — Early Access checkout page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consultr — Early Access</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full mx-auto px-6 py-16 text-center">
    <div class="mb-8">
      <h1 class="text-4xl font-bold text-white mb-3">Consultr</h1>
      <p class="text-gray-400 text-lg">Every client, every deal&mdash;one clear view.</p>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-8 mb-6">
      <div class="text-yellow-400 text-5xl font-bold mb-2">$2</div>
      <div class="text-gray-400 text-sm mb-6">One-time early access</div>
      <ul class="text-left space-y-3 mb-8 text-gray-300 text-sm">
        <li class="flex items-start gap-2"><span class="text-yellow-400 mt-0.5">&#10003;</span>Track proposals &amp; contracts in one dashboard</li>
        <li class="flex items-start gap-2"><span class="text-yellow-400 mt-0.5">&#10003;</span>Manage client communications</li>
        <li class="flex items-start gap-2"><span class="text-yellow-400 mt-0.5">&#10003;</span>Full lifetime access — no subscription</li>
        <li class="flex items-start gap-2"><span class="text-yellow-400 mt-0.5">&#10003;</span>Early backer pricing (limited spots)</li>
      </ul>
      <button
        data-checkout="true"
        id="checkout-btn"
        class="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold py-4 px-8 rounded-xl text-lg transition-all duration-200 shadow-lg hover:shadow-yellow-400/20 cursor-pointer"
      >
        Get Early Access — $2
      </button>
    </div>
    <p class="text-gray-600 text-xs">Secure payment via Stripe &middot; Instant access after purchase</p>
  </div>
  <script>
    const btn = document.getElementById('checkout-btn');
    btn.addEventListener('click', async () => {
      btn.textContent = 'Redirecting...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert('Checkout failed. Please try again.');
          btn.textContent = 'Get Early Access — $2';
          btn.disabled = false;
        }
      } catch (err) {
        alert('Something went wrong. Please try again.');
        btn.textContent = 'Get Early Access — $2';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

// Stripe Checkout Session
app.post('/api/checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: 'price_1TAdrx4Ho2w0775bI6seIN2U',
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
      customer_email: req.body.email || undefined,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

// Success page
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  let customerEmail = '';
  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      customerEmail = session.customer_email || '';
      await sql`
        INSERT INTO orders (email, stripe_session_id, status, total_cents)
        VALUES (${customerEmail}, ${session.id}, 'completed', ${session.amount_total || 200})
        ON CONFLICT (stripe_session_id) DO NOTHING
      `;
    } catch (err) {
      console.error('Session verify error:', err);
    }
  }
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful — Consultr</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full mx-auto px-6 py-16 text-center">
    <div class="text-6xl mb-6">&#x2705;</div>
    <h1 class="text-3xl font-bold text-white mb-3">You're in!</h1>
    <p class="text-gray-400 mb-2">Welcome to Consultr early access.</p>
    ${customerEmail ? `<p class="text-gray-500 text-sm mb-8">Confirmation sent to <span class="text-yellow-400">${customerEmail}</span></p>` : '<p class="text-gray-500 text-sm mb-8">Check your email for confirmation.</p>'}
    <a href="/" class="inline-block bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold py-3 px-8 rounded-xl transition-all duration-200">
      Back to Consultr
    </a>
  </div>
</body>
</html>`);
});

// Cancel page
app.get('/cancel', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Cancelled — Consultr</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full mx-auto px-6 py-16 text-center">
    <div class="text-6xl mb-6">&#x274C;</div>
    <h1 class="text-3xl font-bold text-white mb-3">Payment Cancelled</h1>
    <p class="text-gray-400 mb-8">No worries — you haven't been charged.</p>
    <a href="/" class="inline-block bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold py-3 px-8 rounded-xl transition-all duration-200">
      Back to Consultr
    </a>
  </div>
</body>
</html>`);
});

// ── Error Handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Consultr server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Startup error:', err);
    app.listen(PORT, () => {
      console.log(`Consultr server running on port ${PORT} (DB init failed)`);
    });
  });

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  process.exit(0);
});
