// ========================================
// AURORA IA - EDGE FUNCTION DE CADASTRO
// Arquivo: netlify/edge-functions/auth-register.js
// ========================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export default async (request, context) => {
  // Só aceitar POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Configurar Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Variáveis de ambiente do Supabase não configuradas');
      return new Response(JSON.stringify({ error: 'Configuração do servidor inválida' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ler dados do body
    const { nome, email, telefone, senha, plano = 'essencial' } = await request.json();

    // Validações básicas
    if (!nome || !email || !senha) {
      return new Response(JSON.stringify({ error: 'Nome, email e senha são obrigatórios' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (senha.length < 6) {
      return new Response(JSON.stringify({ error: 'Senha deve ter pelo menos 6 caracteres' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validar formato do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Email inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validar plano (SEM LIVES!)
    const planosValidos = ['essencial', 'completo', 'essencial_anual', 'completo_anual'];
    if (!planosValidos.includes(plano)) {
      return new Response(JSON.stringify({ error: 'Plano inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🚀 Criando usuário: ${email} com plano: ${plano}`);

    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: {
        nome,
        telefone
      }
    });

    if (authError) {
      console.error('❌ Erro na criação do usuário auth:', authError);
      
      if (authError.message.includes('already registered')) {
        return new Response(JSON.stringify({ error: 'Este email já está cadastrado' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ error: 'Erro ao criar conta: ' + authError.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = authData.user.id;
    console.log(`✅ Usuário auth criado: ${userId}`);

    // 2. Buscar configuração do plano
    const { data: planConfig, error: planError } = await supabase
      .from('plan_configs')
      .select('*')
      .eq('id', plano)
      .eq('ativo', true)
      .single();

    if (planError || !planConfig) {
      console.error('❌ Erro ao buscar configuração do plano:', planError);
      return new Response(JSON.stringify({ error: 'Configuração de plano não encontrada' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`📋 Configuração do plano ${plano}:`, planConfig);

    // 3. Calcular período do plano
    const agora = new Date();
    let periodoFim;
    
    if (plano.includes('anual')) {
      periodoFim = new Date(agora.getFullYear() + 1, agora.getMonth(), agora.getDate());
    } else {
      periodoFim = new Date(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());
    }

    // 4. Criar perfil do usuário (SEM CAMPOS DE LIVES!)
    const profileData = {
      id: userId,
      nome,
      email,
      telefone,
      plano,
      status: 'pending_payment', // Começa como pendente
      payment_status: 'pending',
      perguntas_utilizadas: 0,
      perguntas_limite: planConfig.perguntas_mes,
      relatorios_utilizados: 0,
      relatorios_limite: planConfig.relatorios_mes,
      perfis_bebes_limite: planConfig.perfis_bebes,
      periodo_inicio: agora.toISOString(),
      periodo_fim: periodoFim.toISOString(),
      created_at: agora.toISOString(),
      updated_at: agora.toISOString()
    };

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert(profileData)
      .select()
      .single();

    if (profileError) {
      console.error('❌ Erro ao criar perfil:', profileError);
      
      // Tentar deletar usuário auth se perfil falhar
      await supabase.auth.admin.deleteUser(userId);
      
      return new Response(JSON.stringify({ error: 'Erro ao criar perfil do usuário' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ Perfil criado com sucesso`);

    // 5. Inicializar tracking de uso
    const mesAno = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    
    const { error: usageError } = await supabase
      .from('user_usage')
      .insert({
        user_id: userId,
        mes_ano: mesAno,
        perguntas_ia: 0,
        relatorios_gerados: 0,
        atividades_criadas: 0,
        tempo_uso_minutos: 0,
        created_at: agora.toISOString(),
        updated_at: agora.toISOString()
      });

    if (usageError) {
      console.warn('⚠️ Erro ao criar tracking de uso:', usageError);
      // Não falhar por causa disso
    }

    // 6. Enviar WhatsApp de boas-vindas (opcional)
    try {
      if (telefone) {
        await enviarWhatsAppBoasVindas(telefone, nome, plano);
      }
    } catch (whatsappError) {
      console.warn('⚠️ Erro ao enviar WhatsApp:', whatsappError);
      // Não falhar por causa disso
    }

    // ✅ SUCESSO!
    console.log(`🎉 Usuário ${email} criado com sucesso!`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Conta criada com sucesso!',
      user: {
        id: userId,
        nome: profile.nome,
        email: profile.email,
        plano: profile.plano,
        status: profile.status,
        limites: {
          perguntas: profile.perguntas_limite,
          relatorios: profile.relatorios_limite,
          bebes: profile.perfis_bebes_limite
        }
      }
    }), {
      status: 201,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });

  } catch (error) {
    console.error('❌ Erro geral no cadastro:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Erro interno do servidor',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// ========================================
// FUNÇÃO AUXILIAR: WHATSAPP
// ========================================
async function enviarWhatsAppBoasVindas(telefone, nome, plano) {
  const webhookUrl = Deno.env.get('EVOLUTION_API_WEBHOOK_URL');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY');
  
  if (!webhookUrl || !apiKey) {
    console.log('WhatsApp não configurado, pulando...');
    return;
  }

  // Limpar número do telefone
  const numeroLimpo = telefone.replace(/\D/g, '');
  const numeroFormatado = numeroLimpo.startsWith('55') ? numeroLimpo : `55${numeroLimpo}`;

  const planInfo = {
    'essencial': 'Aurora IA Essencial (R$ 19,90/mês)',
    'completo': 'Aurora IA Completo (R$ 34,90/mês)',
    'essencial_anual': 'Aurora IA Essencial Anual (R$ 199,68/ano)',
    'completo_anual': 'Aurora IA Completo Anual (R$ 351,36/ano)'
  };

  const mensagem = `🌟 *Bem-vindo(a) à Aurora IA, ${nome}!*

Sua conta foi criada com sucesso! 🎉

📋 *Plano Selecionado:* ${planInfo[plano] || plano}

🤖 *Próximos passos:*
1. Faça login em: https://aurora-ia.netlify.app/login
2. Complete o pagamento para ativar sua conta
3. Cadastre o perfil do seu bebê
4. Comece a conversar com a Aurora IA!

💡 *Dica:* A Aurora IA está pronta para te ajudar com dúvidas sobre desenvolvimento infantil, sugestões de atividades e muito mais!

Qualquer dúvida, estamos aqui para ajudar! 💙

*Equipe Aurora IA*`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        number: numeroFormatado,
        message: mensagem
      })
    });

    if (response.ok) {
      console.log(`✅ WhatsApp enviado para ${telefone}`);
    } else {
      console.warn(`⚠️ Erro ao enviar WhatsApp: ${response.status}`);
    }
  } catch (error) {
    console.warn('⚠️ Erro ao enviar WhatsApp:', error);
  }
}