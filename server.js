const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Webhook route MUST be before express.json() middleware
app.post('/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('Payment completed:', session.id, 'Customer:', session.customer_email);
    }

    res.json({ received: true });
  }
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Stripe Checkout endpoint (POST creates session, GET confirms route exists)
app.get('/api/checkout', (req, res) => {
  res.json({ status: 'ok', method: 'POST to this endpoint to create a checkout session' });
});

app.post('/api/checkout', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const priceId = process.env.STRIPE_PRICE_ID;

    const sessionConfig = {
      payment_method_types: ['card'],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
      customer_email: req.body.email || undefined,
    };

    if (priceId) {
      sessionConfig.line_items = [{ price: priceId, quantity: 1 }];
    } else {
      sessionConfig.line_items = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Consultr',
            description: 'Every client, every deal—one clear view. One-time access to Consultr.',
          },
          unit_amount: 200,
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

// Success page — shows confirmation then redirects to landing page
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  let customerEmail = '';

  if (session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id);
      customerEmail = session.customer_email || '';
    } catch (err) {
      console.error('Session retrieval failed:', err);
    }
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful — Consultr</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <meta http-equiv="refresh" content="5;url=https://systemprometheus.com/l/consultr">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="text-center p-8 max-w-md">
    <div class="text-6xl mb-4">\u2705</div>
    <h1 class="text-3xl font-bold mb-2 text-gray-900">Payment Successful!</h1>
    <p class="text-gray-600 mb-2">Thank you for purchasing Consultr${customerEmail ? `, ${customerEmail}` : ''}.</p>
    <p class="text-gray-500 text-sm mb-6">You'll receive a confirmation email shortly.</p>
    <p class="text-gray-400 text-xs mb-4">Redirecting you back in 5 seconds\u2026</p>
    <a href="https://systemprometheus.com/l/consultr" class="bg-yellow-400 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:bg-yellow-500 transition-colors">
      Back to Consultr \u2192
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
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="text-center p-8 max-w-md">
    <div class="text-6xl mb-4">\u21a9\ufe0f</div>
    <h1 class="text-3xl font-bold mb-2 text-gray-900">Payment Cancelled</h1>
    <p class="text-gray-600 mb-6">No worries \u2014 you haven't been charged.</p>
    <a href="https://systemprometheus.com/l/consultr" class="bg-yellow-400 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:bg-yellow-500 transition-colors">
      Back to Consultr \u2192
    </a>
  </div>
</body>
</html>`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Consultr server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
