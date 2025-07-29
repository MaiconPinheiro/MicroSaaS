import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export default async (request, context) => {
  // Configurar CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token requerido' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(
    Netlify.env.get('SUPABASE_URL'),
    Netlify.env.get('SUPABASE_ANON_KEY'),
    {
      global: {
        headers: { Authorization: authHeader }
      }
    }
  );

  try {
    // Verificar usuário autenticado
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { pergunta, babyId } = await request.json();
    
    if (!pergunta) {
      return new Response(JSON.stringify({ error: 'Pergunta é obrigatória' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const currentMonth = new Date().toISOString().slice(0, 7); // "2025-01"

    // Buscar perfil do usuário
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: 'Perfil não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verificar se ainda está no trial ou tem plano ativo
    const isTrialActive = profile.plan_type === 'trial' && 
                         new Date(profile.trial_ends_at) > new Date();
    
    if (!isTrialActive && !['essencial', 'completo'].includes(profile.plan_type)) {
      return new Response(JSON.stringify({ 
        error: 'Trial expirado. Faça upgrade do seu plano!',
        needsUpgrade: true 
      }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Buscar configuração do plano
    const { data: planConfig } = await supabase
      .from('plan_configs')
      .select('*')
      .eq('plan_type', profile.plan_type)
      .single();

    // Verificar uso mensal
    let { data: usage } = await supabase
      .from('user_usage')
      .select('*')
      .eq('user_id', user.id)
      .eq('month_year', currentMonth)
      .single();

    // Criar registro de uso se não existir
    if (!usage) {
      const { data: newUsage } = await supabase
        .from('user_usage')
        .insert({
          user_id: user.id,
          month_year: currentMonth,
          ai_questions_used: 0
        })
        .select()
        .single();
      usage = newUsage;
    }

    // Verificar limite (exceto trial)
    if (profile.plan_type !== 'trial' && 
        usage.ai_questions_used >= planConfig.monthly_ai_questions) {
      return new Response(JSON.stringify({ 
        error: `Limite de ${planConfig.monthly_ai_questions} perguntas atingido. Faça upgrade!`,
        needsUpgrade: true,
        currentUsage: usage.ai_questions_used,
        limit: planConfig.monthly_ai_questions
      }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Chamar OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Netlify.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é Aurora IA, especialista em desenvolvimento infantil de 0-24 meses baseada em evidências científicas.
            
IMPORTANTE: Você NÃO é um médico e não oferece diagnósticos médicos.

Baseie suas respostas em:
- Academia Americana de Pediatria (AAP)
- Sociedade Brasileira de Pediatria (SBP)
- Organização Mundial da Saúde (OMS)

Sempre seja educativa, acolhedora e respeitosa. Use linguagem clara e acessível.

ALWAYS INCLUA este disclaimer: "⚠️ Esta informação é educativa. Para questões médicas, consulte sempre um pediatra."

Em emergências, oriente para: SAMU (192) ou Bombeiros (193).`
          },
          {
            role: 'user',
            content: pergunta
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error('Erro OpenAI:', error);
      throw new Error('Erro na API OpenAI');
    }

    const openaiData = await openaiResponse.json();
    const resposta = openaiData.choices[0].message.content;
    const tokensUsados = openaiData.usage?.total_tokens || 0;

    // Incrementar contador de uso
    await supabase
      .from('user_usage')
      .update({ 
        ai_questions_used: usage.ai_questions_used + 1,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .eq('month_year', currentMonth);

    // Salvar conversa
    await supabase
      .from('chat_ia')
      .insert({
        user_id: user.id,
        baby_id: babyId,
        pergunta,
        resposta,
        tokens_usados: tokensUsados
      });

    return new Response(JSON.stringify({
      resposta,
      tokensUsados,
      usage: {
        used: usage.ai_questions_used + 1,
        limit: planConfig.monthly_ai_questions,
        remaining: Math.max(0, planConfig.monthly_ai_questions - (usage.ai_questions_used + 1))
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Erro no chat IA:', error);
    return new Response(JSON.stringify({ 
      error: 'Erro interno do servidor. Tente novamente.' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};