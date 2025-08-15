// netlify/functions/auth-register-test.js - VERSÃO COM CRIAÇÃO MANUAL DE PERFIL
const { createClient } = require('@supabase/supabase-js');

// Usar service role para ter permissões totais
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK'
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  try {
    const { name, email, phone, password, nome, senha, telefone, plano } = JSON.parse(event.body);
    
    // Aceitar formato português e inglês
    const userData = {
      name: name || nome,
      email: email,
      phone: phone || telefone,
      password: password || senha,
      plano: plano || 'essencial'
    };
    
    console.log('📝 Dados recebidos:', { ...userData, password: '[HIDDEN]' });

    if (!userData.name || !userData.email || !userData.password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Nome, email e senha são obrigatórios' })
      };
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email inválido' })
      };
    }

    if (userData.password.length < 6) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Senha deve ter pelo menos 6 caracteres' })
      };
    }

    console.log('✅ Validações passaram, criando usuário...');

    // 🔧 FORÇAR CRIAÇÃO SEM EMAIL CONFIRMATION
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: userData.email,
      password: userData.password,
      email_confirm: true, // Confirmar email automaticamente
      user_metadata: {
        name: userData.name,
        nome: userData.name,
        phone: userData.phone,
        telefone: userData.phone,
        plano: userData.plano
      }
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
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Falha ao criar usuário' })
      };
    }

    console.log('✅ Usuário criado:', authData.user.id);

    // 🔧 CRIAR PERFIL MANUALMENTE (ignorar trigger)
    console.log('🛠️ Criando perfil manualmente...');
    
    const profileData = {
      id: authData.user.id,
      nome: userData.name,
      email: userData.email,
      telefone: userData.phone || null,
      plano: 'essencial',
      status: 'pending_payment',
      payment_status: 'pending',
      perguntas_utilizadas: 0,
      perguntas_limite: 20,
      relatorios_utilizados: 0,
      relatorios_limite: 1,
      perfis_bebes_limite: 2,
      periodo_inicio: new Date().toISOString(),
      periodo_fim: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 dias
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Usar service role para inserir diretamente
    const { data: profileResult, error: profileError } = await supabase
      .from('profiles')
      .insert([profileData])
      .select()
      .single();

    if (profileError) {
      console.error('❌ Erro ao criar perfil:', profileError);
      
      // Se o perfil falhar, deletar o usuário criado
      await supabase.auth.admin.deleteUser(authData.user.id);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erro ao criar perfil: ' + profileError.message })
      };
    }

    console.log('✅ Perfil criado com sucesso:', profileResult);

    // ✅ SUCESSO TOTAL
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Cadastro realizado com sucesso!',
        user: {
          id: authData.user.id,
          email: userData.email,
          nome: userData.name,
          plano: 'Aurora IA Essencial'
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
