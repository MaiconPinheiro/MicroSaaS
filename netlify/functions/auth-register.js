// Edge Function: auth-register.js
// Cadastro direto com pagamento Stripe (sem trial)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export default async (req, context) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Parse request body
    const { nome, email, telefone, senha, plano, preco } = await req.json()

    // Validações básicas
    if (!nome || !email || !telefone || !senha || !plano) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Dados obrigatórios não fornecidos' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Validar planos disponíveis
    const planosValidos = {
      'essencial': {
        nome: 'Aurora IA Essencial',
        preco: 19.90,
        perguntas_mes: 20,
        perfis_bebes: 2,
        relatorios_mes: 1,
        lives_mes: 0,
        stripe_price_id: 'price_essencial_monthly'
      },
      'completo': {
        nome: 'Aurora IA Completo',
        preco: 34.90,
        perguntas_mes: 60,
        perfis_bebes: 5,
        relatorios_mes: 4,
        lives_mes: 1,
        stripe_price_id: 'price_completo_monthly'
      }
    }

    if (!planosValidos[plano]) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Plano inválido selecionado' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const planConfig = planosValidos[plano]

    // Verificar se email já existe
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Email já cadastrado. Faça login ou use outro email.' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: senha,
      email_confirm: true,
      user_metadata: {
        nome: nome,
        telefone: telefone,
        plano: plano
      }
    })

    if (authError) {
      console.error('Erro ao criar usuário:', authError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Erro ao criar conta: ' + authError.message 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const userId = authData.user.id

    // 2. Criar perfil do usuário
    const { error: profileError } = await supabase
      .from('profiles')
      .insert([{
        id: userId,
        nome: nome,
        email: email,
        telefone: telefone,
        plano: plano,
        status: 'pending_payment', // Aguardando pagamento
        perguntas_utilizadas: 0,
        perguntas_limite: planConfig.perguntas_mes,
        perfis_bebes_limite: planConfig.perfis_bebes,
        relatorios_limite: planConfig.relatorios_mes,
        lives_limite: planConfig.lives_mes,
        created_at: new Date().toISOString(),
        periodo_inicio: new Date().toISOString(),
        periodo_fim: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 dias
      }])

    if (profileError) {
      console.error('Erro ao criar perfil:', profileError)
      // Deletar usuário criado se perfil falhou
      await supabase.auth.admin.deleteUser(userId)
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Erro interno. Tente novamente.' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 3. Criar sessão Stripe Checkout
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    
    if (!stripeSecretKey) {
      throw new Error('Stripe não configurado')
    }

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'success_url': `${new URL(req.url).origin}/sucesso?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${new URL(req.url).origin}/?error=payment_cancelled`,
        'payment_method_types[]': 'card',
        'line_items[0][price]': planConfig.stripe_price_id,
        'line_items[0][quantity]': '1',
        'mode': 'subscription',
        'customer_email': email,
        'client_reference_id': userId,
        'metadata[user_id]': userId,
        'metadata[plano]': plano,
        'metadata[nome]': nome,
        'metadata[telefone]': telefone,
        'subscription_data[metadata][user_id]': userId,
        'subscription_data[metadata][plano]': plano
      }).toString()
    })

    if (!stripeResponse.ok) {
      const stripeError = await stripeResponse.text()
      console.error('Erro Stripe:', stripeError)
      
      // Limpar dados criados em caso de erro
      await supabase.auth.admin.deleteUser(userId)
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Erro ao processar pagamento. Tente novamente.' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const stripeSession = await stripeResponse.json()

    // 4. Salvar checkout session ID
    await supabase
      .from('profiles')
      .update({ stripe_checkout_session: stripeSession.id })
      .eq('id', userId)

    // 5. Enviar WhatsApp de boas-vindas (opcional - pode ser após pagamento)
    try {
      const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL')
      const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY')
      
      if (evolutionApiUrl && evolutionApiKey && telefone) {
        const whatsappMessage = `🌅 *Bem-vindo(a) ao Aurora IA!*

Olá *${nome}*! 

Sua conta foi criada com sucesso! ✅

📋 *Detalhes do seu plano:*
• ${planConfig.nome}
• R$ ${planConfig.preco.toFixed(2)}/mês
• ${planConfig.perguntas_mes} perguntas IA/mês
• ${planConfig.perfis_bebes} perfis de bebês

💳 *Próximo passo:*
Complete seu pagamento para ativar sua conta e começar a usar a primeira IA brasileira especializada em desenvolvimento infantil!

⚠️ *Importante:*
Este é um serviço EDUCATIVO. Sempre consulte seu pediatra para questões médicas.

🚨 *Emergências:* 192 (SAMU) | 193 (Bombeiros)

Dúvidas? Responda esta mensagem! 💙`

        await fetch(`${evolutionApiUrl}/message/sendText/${Deno.env.get('EVOLUTION_INSTANCE')}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': evolutionApiKey
          },
          body: JSON.stringify({
            number: telefone,
            text: whatsappMessage
          })
        })
      }
    } catch (whatsappError) {
      console.error('Erro ao enviar WhatsApp:', whatsappError)
      // Não falhamos o cadastro por erro no WhatsApp
    }

    // Retornar sucesso com URL do checkout
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Conta criada com sucesso!',
        checkout_url: stripeSession.url,
        user_id: userId,
        plano: planConfig.nome,
        preco: planConfig.preco,
        next_steps: 'Complete o pagamento para ativar sua conta'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Erro geral:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Erro interno do servidor. Tente novamente.' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
}