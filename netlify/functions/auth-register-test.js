import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Método não permitido' })
      };
    }

    const data = JSON.parse(event.body || '{}');
    const { name, email, phone, plan } = data;

    if (!name || !email || !phone || !plan) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Campos obrigatórios faltando' })
      };
    }

    const { error } = await supabase.from('profiles').insert({
      id: crypto.randomUUID(),
      email,
      created_at: new Date(),
      status: 'active'
    });

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Usuário registrado com sucesso' })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro interno no servidor' })
    };
  }
}
