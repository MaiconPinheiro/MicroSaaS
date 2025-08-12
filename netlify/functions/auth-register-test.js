export default async (request) => {
  try {
    const body = await request.json();

    console.log("📩 Cadastro recebido (modo teste):", body);

    // Simula tempo de processamento
    await new Promise(resolve => setTimeout(resolve, 1000));

    return new Response(
      JSON.stringify({
        success: true,
        checkout_url: "https://aurora-ia.netlify.app/sucesso-teste"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("❌ Erro no cadastro de teste:", err);
    return new Response(
      JSON.stringify({ success: false, message: "Erro no cadastro de teste" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
