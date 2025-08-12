import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  try {
    const { name, email, phone, password, plan } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios faltando' });
    }

    const { data: user, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, phone, plan }
    });

    if (error) {
      console.error("Erro Supabase:", error); // Log no servidor
      return res.status(400).json({ success: false, message: error.message || "Erro desconhecido" });
    }

    return res.status(200).json({ success: true, message: 'Usuário criado com sucesso', user });
  } catch (error) {
    console.error("Erro geral:", error); // Log no servidor
    return res.status(500).json({ success: false, message: error.message || "Erro interno" });
  }
};
