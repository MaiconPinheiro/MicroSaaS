const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: "Método não permitido" }),
        };
    }

    try {
        const { name, email, phone, password } = JSON.parse(event.body);

        if (!name || !email || !phone || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Campos obrigatórios faltando" }),
            };
        }

        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: { name, phone }
        });

        if (error) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: error.message }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Usuário criado com sucesso", user: data }),
        };

    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Erro interno no servidor" }),
        };
    }
};
