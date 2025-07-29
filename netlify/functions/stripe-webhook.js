// Edge Function: stripe-webhook.js
// Webhook para processar eventos do Stripe (pagamentos confirmados, cancelados, etc.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export default async (req, context) => {
  try {
    // Verificar assinatura do webhook Stripe
    const stripeSignature = req.headers.get('stripe-signature')
    const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    
    if (!stripeSignature || !stripeWebhookSecret) {
      return new Response('Webhook não autorizado', { status: 401 })
    }

    const body = await req.text()
    
    // Verificar assinatura (simplificado - em produção usar crypto.subtle)
    // Em produção real, implementar verificação completa da assinatura Stripe
    
    const event = JSON.parse(body)
    
    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Stripe webhook event:', event.type)

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, supabase)
        break
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object, supabase)
        break
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, supabase)
        break
        
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object, supabase)
        break
        
      default:
        console.log(`Evento não tratado: ${event.type}`)
    }

    return new Response('OK', { status: 200 })

  } catch (error) {
    console.error('Erro no webhook:', error)
    return new Response('Erro interno', { status: 500 })
  }
}

// Pagamento inicial confirmado
async function handleCheckoutCompleted(session, supabase) {
  const userId = session.client_reference_id || session.metadata?.user_id
  
  if (!userId) {
    console.error('User ID não encontrado no checkout session')
    return
  }

  try {
    // Ativar conta do usuário
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        status: 'active',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        payment_status: 'paid',
        activated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (updateError) {
      console.error('Erro ao ativar usuário:', updateError)
      return
    }

    // Buscar dados do usuário para enviar confirmação
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (user && user.telefone) {
      await sendActivationWhatsApp(user)
    }

    console.log(`Usuário ${userId} ativado com sucesso!`)

  } catch (error) {
    console.error('Erro ao processar checkout completed:', error)
  }
}

// Renovação de assinatura bem-sucedida
async function handlePaymentSucceeded(invoice, supabase) {
  const customerId = invoice.customer
  
  try {
    // Buscar usuário pelo customer ID
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single()

    if (user) {
      // Renovar período de billing
      const novoInicio = new Date()
      const novoFim = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias

      await supabase
        .from('profiles')
        .update({
          status: 'active',
          payment_status: 'paid',
          periodo_inicio: novoInicio.toISOString(),
          periodo_fim: novoFim.toISOString(),
          perguntas_utilizadas: 0, // Reset contador mensal
          relatorios_utilizados: 0
        })
        .eq('id', user.id)

      // Buscar configuração do plano atual
      const planConfig = getPlanConfig(user.plano)
      
      if (planConfig) {
        await supabase
          .from('profiles')
          .update({
            perguntas_limite: planConfig.perguntas_mes,
            relatorios_limite: planConfig.relatorios_mes,
            lives_limite: planConfig.lives_mes
          })
          .eq('id', user.id)
      }

      console.log(`Assinatura renovada para usuário ${user.id}`)
    }

  } catch (error) {
    console.error('Erro ao processar payment succeeded:', error)
  }
}

// Falha no pagamento
async function handlePaymentFailed(invoice, supabase) {
  const customerId = invoice.customer
  
  try {
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single()

    if (user) {
      await supabase
        .from('profiles')
        .update({
          status: 'payment_failed',
          payment_status: 'failed'
        })
        .eq('id', user.id)

      // Enviar notificação por WhatsApp
      if (user.telefone) {
        await sendPaymentFailedWhatsApp(user)
      }

      console.log(`Pagamento falhou para usuário ${user.id}`)
    }

  } catch (error) {
    console.error('Erro ao processar payment failed:', error)
  }
}

// Assinatura cancelada
async function handleSubscriptionCancelled(subscription, supabase) {
  const customerId = subscription.customer
  
  try {
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single()

    if (user) {
      await supabase
        .from('profiles')
        .update({
          status: 'cancelled',
          payment_status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', user.id)

      // Enviar confirmação de cancelamento
      if (user.telefone) {
        await sendCancellationWhatsApp(user)
      }

      console.log(`Assinatura cancelada para usuário ${user.id}`)
    }

  } catch (error) {
    console.error('Erro ao processar subscription cancelled:', error)
  }
}

// Configurações dos planos
function getPlanConfig(plano) {
  const configs = {
    'essencial': {
      perguntas_mes: 20,
      relatorios_mes: 1,
      lives_mes: 0
    },
    'completo': {
      perguntas_mes: 60,
      relatorios_mes: 4,
      lives_mes: 1
    }
  }
  
  return configs[plano] || null
}

// Enviar WhatsApp de ativação
async function sendActivationWhatsApp(user) {
  try {
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL')
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY')
    
    if (!evolutionApiUrl || !evolutionApiKey) return

    const message = `🎉 *Conta Aurora IA Ativada!*

Parabéns *${user.nome}*! 

✅ Seu pagamento foi confirmado e sua conta está ATIVA!

🚀 *Agora você pode:*
• Fazer perguntas para nossa IA especializada
• Cadastrar perfis dos seus bebês
• Acompanhar marcos de desenvolvimento
• Gerar relatórios personalizados

🌅 *Acesse agora:*
${Deno.env.get('SITE_URL') || 'https://aurora-ia.netlify.app'}

📱 *Seu plano:* ${user.plano}
⏰ *Válido até:* ${new Date(user.periodo_fim).toLocaleDateString('pt-BR')}

⚠️ *Lembre-se:*
Aurora IA é educativo. Sempre consulte seu pediatra para questões médicas.

Bem-vindo(a) à família Aurora IA! 💙✨`

    await fetch(`${evolutionApiUrl}/message/sendText/${Deno.env.get('EVOLUTION_INSTANCE')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey
      },
      body: JSON.stringify({
        number: user.telefone,
        text: message
      })
    })

  } catch (error) {
    console.error('Erro ao enviar WhatsApp de ativação:', error)
  }
}

// Enviar WhatsApp de falha no pagamento
async function sendPaymentFailedWhatsApp(user) {
  try {
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL')
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY')
    
    if (!evolutionApiUrl || !evolutionApiKey) return

    const message = `⚠️ *Problema com seu Pagamento*

Olá *${user.nome}*,

Identificamos um problema com o pagamento da sua assinatura Aurora IA.

💳 *O que fazer:*
• Verifique os dados do seu cartão
• Confirme se há limite disponível
• Entre em contato com seu banco se necessário

🔄 *Renovar pagamento:*
${Deno.env.get('SITE_URL') || 'https://aurora-ia.netlify.app'}

📞 *Precisa de ajuda?*
Responda esta mensagem ou entre em contato conosco.

Estamos aqui para ajudar! 💙`

    await fetch(`${evolutionApiUrl}/message/sendText/${Deno.env.get('EVOLUTION_INSTANCE')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey
      },
      body: JSON.stringify({
        number: user.telefone,
        text: message
      })
    })

  } catch (error) {
    console.error('Erro ao enviar WhatsApp de falha:', error)
  }
}

// Enviar WhatsApp de cancelamento
async function sendCancellationWhatsApp(user) {
  try {
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL')
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY')
    
    if (!evolutionApiUrl || !evolutionApiKey) return

    const message = `😢 *Assinatura Cancelada*

Olá *${user.nome}*,

Sua assinatura Aurora IA foi cancelada conforme solicitado.

📋 *Seus dados:*
• Permanecem seguros por 30 dias
• Você pode reativar a qualquer momento
• Sem multas ou taxas adicionais

🔄 *Quer voltar?*
Será sempre bem-vindo(a)! Acesse:
${Deno.env.get('SITE_URL') || 'https://aurora-ia.netlify.app'}

💙 *Obrigado por ter confiado na Aurora IA!*

Sucesso com seu bebê! 🌅👶`

    await fetch(`${evolutionApiUrl}/message/sendText/${Deno.env.get('EVOLUTION_INSTANCE')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey
      },
      body: JSON.stringify({
        number: user.telefone,
        text: message
      })
    })

  } catch (error) {
    console.error('Erro ao enviar WhatsApp de cancelamento:', error)
  }
}