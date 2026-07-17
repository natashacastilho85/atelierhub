const express = require('express');
const Stripe  = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const cron    = require('node-cron');

const app      = express();
const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── VAPID ──
webpush.setVapidDetails(
  'mailto:contato@atelierhub.com.br',
  'BNzqvG6jLhI3UTKyRvlIBbij_rEpo0SfbuzzpXUTS7Utiz0fFfv5plAZEE2xP9NRz3qfaSHGAh0EvKaKO7qKpkw',
  process.env.VAPID_PRIVATE_KEY
);

// ── Helpers de data ──
function getBrazilToday() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc - 3 * 60 * 60000).toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

function totalPago(c) {
  // Precisa bater exatamente com a mesma função no app (index.html): Pix, Dinheiro e Débito
  // usam o líquido (a cliente pagou menos, por causa do desconto); Cartão usa o bruto (a
  // cliente é cobrada o valor cheio, a taxa da maquininha é custo do ateliê, não da cliente).
  // Assinatura igual à do app: recebe o contrato inteiro, não só o array de pagamentos —
  // permite o fallback abaixo pro campo legado 'pago', pra contratos retroativos/fora do
  // fluxo padrão que ainda não tenham nenhum pagamento no array.
  if (Array.isArray(c?.pagamentos) && c.pagamentos.length) {
    return c.pagamentos.reduce((s, p) => {
      const usaLiquido = p.forma === 'Pix' || p.forma === 'Dinheiro' || p.forma === 'Débito';
      const valor = usaLiquido ? p.valor : (p.bruto ?? p.valor);
      return s + (parseFloat(valor) || 0);
    }, 0);
  }
  return parseFloat(c?.pago) || 0;
}

// Precisa bater exatamente com a mesma função no app (index.html): soma o desconto REAL
// concedido em cada pagamento Pix/Dinheiro/Débito já registrado (bruto - líquido), nunca a
// taxa configurada hoje. Sem isso, o saldo usado pro lembrete de cobrança ficava incorreto
// sempre que havia desconto concedido — o mesmo bug que já tínhamos corrigido no app, mas que
// vivia aqui, sem correção, de forma independente.
function descontoMistoConcedido(c) {
  if (!Array.isArray(c?.pagamentos)) return 0;
  return c.pagamentos
    .filter(p => p.forma === 'Pix' || p.forma === 'Dinheiro' || p.forma === 'Débito')
    .reduce((s, p) => {
      const bruto = parseFloat(p.bruto ?? p.valor) || 0;
      const liquido = parseFloat(p.valor) || 0;
      return s + Math.max(0, bruto - liquido);
    }, 0);
}

// ── Envia push para todos os dispositivos do usuário ──
async function enviarPush(userId, titulo, corpo, contratoId) {
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription, endpoint')
      .eq('user_id', userId);

    if (!subs || !subs.length) return;

    const payload = JSON.stringify({
      title: titulo,
      body:  corpo,
      ...(contratoId ? { contratoId } : {}),
    });

    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        console.log(`[push] Enviado para endpoint: ${row.endpoint.slice(0, 60)}...`);
      } catch (err) {
        console.error(`[push] Falha ao enviar: status=${err.statusCode} body=${err.body}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from('push_subscriptions')
            .delete().eq('endpoint', row.endpoint);
          console.log('[push] Subscrição expirada removida.');
        }
      }
    }
  } catch (err) {
    console.error(`[push] Erro para ${userId}:`, err.message);
  }
}

// ── Dispara notificação: loga no push_log e envia push ──
async function disparar(userId, chave, titulo, corpo, contratoId) {
  const { error } = await supabase.from('push_log').insert({
    user_id: userId,
    chave,
    data: getBrazilToday(),
  });
  if (error) {
    if (error.code === '23505') return; // já disparada
    console.error(`[notif] Erro ao logar ${chave}:`, error.message);
    return;
  }
  await enviarPush(userId, titulo, corpo, contratoId);
  console.log(`[notif] ✅ ${chave}`);
}

// ── Verificação diária das 8 notificações automáticas ──
async function verificarNotificacoes() {
  const today = getBrazilToday();
  console.log(`[notif] Rodando para ${today}`);

  const { data: contratos, error } = await supabase
    .from('contratos')
    .select('id, casamento, status, forma_pag, tipo_quitacao, pagamentos, pago, valor_bruto, acrescimo, desconto, chegada, entrega, nome, user_id')
    .neq('status', 'Cancelado');

  if (error) { console.error('[notif] Erro ao buscar contratos:', error); return; }
  if (!contratos || !contratos.length) { console.log('[notif] Nenhum contrato ativo.'); return; }

  console.log(`[notif] ${contratos.length} contrato(s)`);

  // Busca em lote os dois modelos de prazo de quitação (antes do casamento / após entrega) de
  // cada usuária que tem ao menos um contrato Reserva com entrada OU Reserva sem entrada — os
  // dois modelos agora valem pra qualquer um dos dois tipos, dependendo da escolha de cada
  // contrato (tipo_quitacao), não mais fixo pelo tipo. Usuária sem configuração feita ainda:
  // nenhum lembrete desse modelo é disparado para ela (sem enforcement até ela configurar).
  const uidsReservaFamily = [...new Set(contratos.filter(c => (c.forma_pag === 'reserva' || c.forma_pag === 'entrega_prazo') && c.user_id).map(c => c.user_id))];
  const configCasamentoPorUid = new Map();
  const configEntregaPorUid = new Map();
  if (uidsReservaFamily.length) {
    const { data: configs, error: errCfg } = await supabase
      .from('configuracoes')
      .select('user_id, valor')
      .eq('chave', 'villare-custos')
      .in('user_id', uidsReservaFamily);
    if (errCfg) {
      console.error('[notif] Erro ao buscar config de prazo de quitação:', errCfg.message);
    } else if (configs) {
      for (const row of configs) {
        const v = row.valor || {};
        const prazo = v.prazoReserva;
        const notifDias = v.notifDiasAntesReserva;
        if (prazo !== null && prazo !== undefined && notifDias !== null && notifDias !== undefined) {
          configCasamentoPorUid.set(row.user_id, { prazo, notifDias });
        }
        const diasAviso = v.diasAvisoEntrega;
        if (diasAviso !== null && diasAviso !== undefined) {
          configEntregaPorUid.set(row.user_id, { diasAviso });
        }
      }
    }
  }

  for (const c of contratos) {
    if (!c.casamento || !c.user_id) continue;
    const uid = c.user_id;
    const id  = c.id;
    const cas = c.casamento.split('T')[0];

    // 1. 💍 7 dias antes do casamento
    if (addDays(cas, -7) === today)
      await disparar(uid, `7d-${id}`, '💍 Casamento em 7 dias', `${c.nome} — o grande dia está chegando!`, id);

    // 2. 💰 Lembrete de saldo — Reserva com entrada OU Reserva sem entrada, usando o prazo de
    // quitação escolhido em CADA contrato (tipo_quitacao), não mais fixo pelo tipo. Contratos
    // antigos sem essa escolha explícita usam o comportamento de sempre (com entrada→casamento,
    // sem entrada→entrega), pra não mudar nada retroativamente. Nome da notificação (chave)
    // preservado do jeito que já era, pra não duplicar aviso em contrato que já recebeu o
    // lembrete antes dessa mudança.
    if (c.forma_pag === 'reserva' || c.forma_pag === 'entrega_prazo') {
      const tipoQuitacao = c.tipo_quitacao || (c.forma_pag === 'reserva' ? 'casamento' : 'entrega');

      if (tipoQuitacao === 'casamento') {
        const cfg = configCasamentoPorUid.get(uid);
        if (cfg) {
          const diasAntes = cfg.prazo + cfg.notifDias;
          if (addDays(cas, -diasAntes) === today) {
            const baseC = (parseFloat(c.valor_bruto) || 0) + (parseFloat(c.acrescimo) || 0) - (parseFloat(c.desconto) || 0);
            const saldo = baseC - descontoMistoConcedido(c) - totalPago(c);
            if (saldo > 0.01)
              await disparar(uid, `reserva-${id}`, '💰 Lembrete de saldo',
                `${c.nome} — saldo de R$${saldo.toFixed(2).replace('.', ',')} em aberto`, id);
          }
        }
      } else if (tipoQuitacao === 'entrega' && c.entrega) {
        const cfgE = configEntregaPorUid.get(uid);
        if (cfgE) {
          const dataEntrega = c.entrega.split('T')[0];
          if (addDays(dataEntrega, cfgE.diasAviso) === today) {
            const baseC2 = (parseFloat(c.valor_bruto) || 0) + (parseFloat(c.acrescimo) || 0) - (parseFloat(c.desconto) || 0);
            const saldo = baseC2 - descontoMistoConcedido(c) - totalPago(c);
            if (saldo > 0.01)
              await disparar(uid, `entregaprazo-${id}`, '💰 Lembrete de saldo',
                `${c.nome} — saldo de R$${saldo.toFixed(2).replace('.', ',')} em aberto`, id);
          }
        }
      }
      // Sem configuração feita ainda pro modelo escolhido: nenhum lembrete é disparado.
    }

    // 3. 📦 Confirmação de envio — 1 dia útil após casamento
    if (addBusinessDays(cas, 1) === today)
      await disparar(uid, `envio1du-${id}`, '📦 Confirmação de envio', `${c.nome} — confirme o envio do buquê`, id);

    // 4, 5, 6. 🌸 Buquê chegou? — só se não tiver data de chegada
    if (!c.chegada) {
      if (addBusinessDays(cas, 3) === today)
        await disparar(uid, `buque3du-${id}`, '🌸 Buquê chegou?', `${c.nome} — 3 dias úteis após o casamento`, id);
      if (addBusinessDays(cas, 5) === today)
        await disparar(uid, `buque5du-${id}`, '🌸 Buquê chegou?', `${c.nome} — 5 dias úteis após o casamento`, id);
      if (addBusinessDays(cas, 8) === today)
        await disparar(uid, `buque8du-${id}`, '🌸 Buquê chegou?', `${c.nome} — 8 dias úteis, sem confirmação de chegada`, id);
    }

    // 7. ⏰ Prazo de produção — 20 dias antes da entrega (só se tiver entrega e chegada)
    if (c.entrega && c.chegada) {
      const entrega = c.entrega.split('T')[0];
      if (addDays(entrega, -20) === today)
        await disparar(uid, `prazo20-${id}`, '⏰ Prazo de produção', `${c.nome} — faltam 20 dias para a entrega`, id);
    }

    // 8. 💍 Dia do casamento
    if (cas === today)
      await disparar(uid, `casamento-${id}`, '💍 Dia do casamento!', `Hoje é o grande dia de ${c.nome}! 🌸`, id);
  }

  console.log('[notif] Verificação concluída.');
}

// ── Verificação de notificações manuais (a cada 1 minuto) ──
async function verificarNotifManuais() {
  try {
    const agora = new Date().toISOString();
    const { data: pendentes, error } = await supabase
      .from('notif_manuais')
      .select('id, user_id, texto, data_hora')
      .eq('disparada', false)
      .lte('data_hora', agora);

    if (error) { console.error('[manual] Erro ao buscar:', error.message); return; }
    if (!pendentes || !pendentes.length) return;

    for (const n of pendentes) {
      await enviarPush(n.user_id, '🔔 Atelier Hub', n.texto);
      await supabase.from('notif_manuais')
        .update({ disparada: true })
        .eq('id', n.id);
      console.log(`[manual] ✅ ${n.id} — ${n.texto.slice(0, 40)}`);
    }
  } catch(err) {
    console.error('[manual] Erro:', err.message);
  }
}

// ── Cron: notificações manuais a cada 1 minuto ──
cron.schedule('* * * * *', verificarNotifManuais, { timezone: 'UTC' });

// ── Cron: notificações automáticas todo dia às 8h de Brasília (= 11h UTC) ──
cron.schedule('0 11 * * *', verificarNotificacoes, { timezone: 'UTC' });

// ── Health check ──
app.get('/', (req, res) => res.send('AtelierHub Backend · OK'));

// ── Endpoint para disparar manualmente (teste) ──
app.get('/run-notif', async (req, res) => {
  await verificarNotificacoes();
  res.json({ ok: true, ran: new Date().toISOString() });
});

// ── Stripe webhook ──
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

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub      = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const status   = sub.status === 'active' ? 'ativa' : 'expirada';
        const inicio   = new Date(sub.current_period_start * 1000).toISOString();
        const fim      = new Date(sub.current_period_end   * 1000).toISOString();
        const { error } = await supabase.from('assinaturas')
          .update({ status, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, assinatura_inicio: inicio, assinatura_fim: fim })
          .eq('email', customer.email);
        if (error) console.error('Supabase update error (sub):', error);
        else console.log(`Assinatura ${status} para ${customer.email}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const [sub, customer] = await Promise.all([
          stripe.subscriptions.retrieve(invoice.subscription),
          stripe.customers.retrieve(invoice.customer)
        ]);
        const fim = new Date(sub.current_period_end * 1000).toISOString();
        const { error } = await supabase.from('assinaturas')
          .update({ status: 'ativa', assinatura_fim: fim, stripe_customer_id: invoice.customer, stripe_subscription_id: invoice.subscription })
          .eq('email', customer.email);
        if (error) console.error('Supabase update error (payment):', error);
        else console.log(`Pagamento confirmado para ${customer.email}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const customer = await stripe.customers.retrieve(invoice.customer);
        await supabase.from('assinaturas').update({ status: 'expirada' }).eq('email', customer.email);
        console.warn(`Pagamento falhou para ${customer.email}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub      = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        await supabase.from('assinaturas')
          .update({ status: 'cancelada', assinatura_fim: new Date().toISOString() })
          .eq('email', customer.email);
        console.log(`Assinatura cancelada para ${customer.email}`);
        break;
      }

      default: break;
    }
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AtelierHub Backend rodando na porta ${PORT}`));
