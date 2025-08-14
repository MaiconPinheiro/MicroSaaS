// netlify/functions/auth-register-test.js - VERSÃO CORRIGIDA

const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase com variáveis de ambiente CORRETAS
const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),                // ✅ CORRIGIDO: Deno.env.get
  Deno.env.get('SUPABASE_ANON_KEY')           // ✅ CORRIGIDO: ANON_KEY em vez de SERVICE_ROLE
);

exports.handler = async (event) => {
  console.log('🌟 Aurora IA - Auth Register Test Function');
  
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK'
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  try {
    // Parse request body
    const { name, email, phone, password } = JSON.parse(event.body);
    
    console.log('📝 Dados recebidos:', { name, email, phone, password: '[HIDDEN]' });

    // Validação básica
    if (!name || !email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Nome, email e senha são obrigatórios' })
      };
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email inválido' })
      };
    }

    // Validar senha
    if (password.length < 6) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Senha deve ter pelo menos 6 caracteres' })
      };
    }

    console.log('✅ Validações passaram, criando usuário...');

    // Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    if (authError) {
      console.error('❌ Erro Supabase Auth:', authError);
      
      if (authError.message.includes('already registered')) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Este email já está cadastrado' })
        };
      }
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: authError.message })
      };
    }

    if (!authData.user) {
      console.error('❌ Usuário não foi criado');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Falha ao criar usuário' })
      };
    }

    console.log('✅ Usuário criado:', authData.user.id);

    // Criar perfil do usuário
    const profileData = {
      id: authData.user.id,
      nome: name,
      email: email,
      telefone: phone || null,
      plano: 'essencial',
      status: 'pending_payment',
      payment_status: 'pending',
      perguntas_utilizadas: 0,
      perguntas_limite: 20,
      relatorios_utilizados: 0,
      relatorios_limite: 1,
      perfis_bebes_limite: 2,
      periodo_inicio: new Date().toISOString(),
      periodo_fim: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 dias
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: profileResult, error: profileError } = await supabase
      .from('profiles')
      .insert([profileData])
      .select();

    if (profileError) {
      console.error('❌ Erro ao criar perfil:', profileError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erro ao criar perfil: ' + profileError.message })
      };
    }

    console.log('✅ Perfil criado com sucesso');

    // Sucesso
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Cadastro realizado com sucesso!',
        user: {
          id: authData.user.id,
          email: email,
          nome: name
        }
      })
    };

  } catch (error) {
    console.error('❌ Erro geral:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erro interno do servidor',
        details: error.message
      })
    };
  }
};
