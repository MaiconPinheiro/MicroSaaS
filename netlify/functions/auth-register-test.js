import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  console.log("📩 Nova requisição recebida no /auth-register-test");

  if (req.method !== 'POST') {
    console.warn("Método não permitido:", req.method);
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  try {
    const { name, email, phone, password, plan } = req.body;
    console.log("📦 Dados recebidos:", { name, email, phone, plan });

    if (!name || !email || !password) {
      console.warn("❌ Campos obrigatórios faltando");
      return res.status(400).json({ success: false, message: 'Preencha todos os campos obrigatórios' });
    }

    // Criar usuário no Supabase Auth
    console.log("👤 Criando usuário no Supabase...");
    const { data: user, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone, plan }
    });

    if (signUpError) {
      console.error("⚠️ Erro ao criar usuário no Supabase:", signUpError);
      return res.status(500).json({ success: false, message: 'Erro ao criar usuário', error: signUpError });
    }

    console.log("✅ Usuário criado com sucesso:", user);

    // Inserir no perfil
    console.log("🗄️ Inserindo dados na tabela profiles...");
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.user.id,
        email,
        created_at: new Date(),
        status: 'active'
      });

    if (profileError) {
      console.error("⚠️ Erro ao salvar no profiles:", profileError);
      return res.status(500).json({ success: false, message: 'Erro ao salvar no perfil', error: profileError });
    }

    console.log("🎉 Cadastro concluído com sucesso!");
    res.status(200).json({ success: true, message: 'Usuário registrado com sucesso' });

  } catch (error) {
    console.error("💥 Erro inesperado:", error);
    res.status(500).json({ success: false, message: 'Erro interno', error: error.message });
  }
};
