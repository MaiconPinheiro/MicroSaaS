import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export default async (request, context) => {
  // Só aceita POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Configurar CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Responder OPTIONS para CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Criar cliente Supabase
  const supabase = createClient(
    Netlify.env.get('SUPABASE_URL'),
    Netlify.env.get('SUPABASE_ANON_KEY')
  );

  try {
    // Pegar dados do formulário
    const { email, password, fullName, phone, selectedPlan } = await request.json();

    // Validações básicas
    if (!email || !password || !fullName || !selectedPlan) {
      return new Response(JSON.stringify({ 
        error: 'Email, senha, nome completo e plano são obrigatórios' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validar plano selecionado
    if (!['essencial', 'completo'].includes(selectedPlan)) {
      return new Response(JSON.stringify({ 
        error: 'Plano inválido. Escolha entre Essencial ou Completo' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Registrar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: phone || '',
          selected_plan: selectedPlan
        }
      }
    });

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError.message 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Sucesso!
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Conta criada com sucesso! Plano ${selectedPlan} selecionado.`,
      redirectToPayment: true,
      selectedPlan: selectedPlan,
      user: {
        id: authData.user?.id,
        email: authData.user?.email
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Erro no cadastro:', error);
    return new Response(JSON.stringify({ 
      error: 'Erro interno do servidor' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};