const express = require('express');
const Stripe  = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app      = express();
const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Health check ──
app.get('/', (req, res) => res.send('AtelierHub Backend · OK'));

// ── Stripe webhook (raw body obrigatório para verificar assinatura) ──
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // Assinatura criada ou atualizada (upgrade, downgrade, renovação)
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub      = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const status   = sub.status === 'active' ? 'ativa' : 'expirada';
        const inicio   = new Date(sub.current_period_start * 1000).toISOString();
        const fim      = new Date(sub.current_period_end   * 1000).toISOString();

        const { error } = await supabase
          .from('assinaturas')
          .update({
            status,
            stripe_customer_id:     sub.customer,
            stripe_subscription_id: sub.id,
            assinatura_inicio: inicio,
            assinatura_fim:    fim
          })
          .eq('email', customer.email);

        if (error) console.error('Supabase update error (sub created/updated):', error);
        else console.log(`Assinatura ${status} para ${customer.email}`);
        break;
      }

      // Pagamento bem-sucedido — garante status ativa após renovação
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        const [sub, customer] = await Promise.all([
          stripe.subscriptions.retrieve(invoice.subscription),
          stripe.customers.retrieve(invoice.customer)
        ]);
        const fim = new Date(sub.current_period_end * 1000).toISOString();

        const { error } = await supabase
          .from('assinaturas')
          .update({
            status: 'ativa',
            assinatura_fim:         fim,
            stripe_customer_id:     invoice.customer,
            stripe_subscription_id: invoice.subscription
          })
          .eq('email', customer.email);

        if (error) console.error('Supabase update error (payment succeeded):', error);
        else console.log(`Pagamento confirmado para ${customer.email} · válido até ${fim}`);
        break;
      }

      // Pagamento falhou — marca como expirada
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        const customer = await stripe.customers.retrieve(invoice.customer);
        const { error } = await supabase
          .from('assinaturas')
          .update({ status: 'expirada' })
          .eq('email', customer.email);

        if (error) console.error('Supabase update error (payment failed):', error);
        else console.warn(`Pagamento falhou para ${customer.email}`);
        break;
      }

      // Assinatura cancelada
      case 'customer.subscription.deleted': {
        const sub      = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);

        const { error } = await supabase
          .from('assinaturas')
          .update({ status: 'cancelada', assinatura_fim: new Date().toISOString() })
          .eq('email', customer.email);

        if (error) console.error('Supabase update error (sub deleted):', error);
        else console.log(`Assinatura cancelada para ${customer.email}`);
        break;
      }

      default:
        // Ignora eventos não tratados
        break;
    }
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
    // Retorna 200 para não forçar retry do Stripe em erros de lógica
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AtelierHub Backend rodando na porta ${PORT}`));
