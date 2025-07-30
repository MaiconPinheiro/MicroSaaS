// netlify/edge-functions/test-connection.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export default async (request, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  }

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Teste 1: Verificar variáveis de ambiente
    const supabaseUrl = Deno.env.get('SUPABASE_DATABASE_URL') || Deno.env.get('NEXT_PUBLIC_SUPABASE_DATABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    console.log('🔍 Verificando variáveis de ambiente...')
    console.log('URL existe:', !!supabaseUrl)
    console.log('ANON KEY existe:', !!supabaseAnonKey)
    console.log('SERVICE KEY existe:', !!supabaseServiceKey)

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Variáveis de ambiente não encontradas',
        details: {
          url: !!supabaseUrl,
          anonKey: !!supabaseAnonKey,
          serviceKey: !!supabaseServiceKey
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Teste 2: Conexão com Supabase (Service Role)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('🔗 Testando conexão com Supabase...')

    // Teste 3: Verificar se as tabelas existem
    const { data: tables, error: tablesError } = await supabase
      .from('plan_configs')
      .select('*')
      .limit(5)

    if (tablesError) {
      console.error('❌ Erro ao acessar tabelas:', tablesError)
      return new Response(JSON.stringify({
        success: false,
        error: 'Erro ao acessar banco de dados',
        details: tablesError
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Teste 4: Verificar estrutura das tabelas principais
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .limit(1)

    const { data: userUsage, error: usageError } = await supabase
      .from('user_usage')
      .select('*')
      .limit(1)

    console.log('✅ Conexão com Supabase estabelecida!')
    console.log('📊 Planos configurados:', tables?.length || 0)

    return new Response(JSON.stringify({
      success: true,
      message: '🎉 Conexão Netlify ↔ Supabase funcionando!',
      tests: {
        environmentVariables: '✅ OK',
        supabaseConnection: '✅ OK',
        tablesAccess: '✅ OK',
        planConfigs: tables?.length || 0,
        profilesTable: !profilesError ? '✅ OK' : '❌ Erro',
        userUsageTable: !usageError ? '✅ OK' : '❌ Erro'
      },
      data: {
        planConfigs: tables,
        supabaseUrl: supabaseUrl.replace(/\/\/.*@/, '//***@'), // Hide credentials
        timestamp: new Date().toISOString()
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('💥 Erro geral:', error)
    return new Response(JSON.stringify({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}