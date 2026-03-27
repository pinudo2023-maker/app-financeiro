const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    try {
        const { user_id, text } = JSON.parse(event.body);

        if (!user_id || !text) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing user_id or text in request body' }),
            };
        }

        // 1. Chamar a IA via OpenRouter
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

        const aiPrompt = `Você é um assistente financeiro. Analise o seguinte texto e extraia o tipo de transação (income ou expense), o valor numérico e uma descrição curta. Responda APENAS com um objeto JSON no formato: { "type": "income" | "expense", "amount": number, "description": string }. Não inclua nenhum texto adicional, explicações ou formatação além do JSON. Se não conseguir extrair o valor, use 0. Se não conseguir extrair a descrição, use uma string vazia. Texto: "${text}"`;

        const aiResponse = await fetch(openRouterUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': event.headers.host, // Necessário para OpenRouter
                'X-Title': 'Finance App', // Necessário para OpenRouter
            },
            body: JSON.stringify({
                model: 'openai/gpt-3.5-turbo', // Pode ser ajustado para outro modelo compatível
                messages: [
                    { role: 'user', content: aiPrompt }
                ],
                response_format: { type: 'json_object' }, // Garante que a resposta seja JSON
            }),
        });

        if (!aiResponse.ok) {
            const errorData = await aiResponse.json();
            console.error('OpenRouter API Error:', errorData);
            return {
                statusCode: aiResponse.status,
                body: JSON.stringify({ message: 'Error calling AI API', details: errorData }),
            };
        }

        const aiData = await aiResponse.json();
        const parsedIntentContent = aiData.choices[0].message.content;
        let parsedIntent;
        try {
            parsedIntent = JSON.parse(parsedIntentContent);
        } catch (jsonError) {
            console.error('Failed to parse AI response as JSON:', parsedIntentContent, jsonError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'AI response was not valid JSON', raw: parsedIntentContent }),
            };
        }

        // 2. Salvar o resultado no Supabase
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

        const supabase = createClient(supabaseUrl, supabaseAnonKey);

        const { data, error } = await supabase
            .from('pending_ai_actions')
            .insert([
                {
                    user_id: user_id,
                    raw_input: text,
                    parsed_intent: parsedIntent,
                    status: 'pending',
                },
            ]);

        if (error) {
            console.error('Supabase Error:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Error saving to Supabase', details: error }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Pending AI action created successfully', data }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error', details: error.message }),
        };
    }
};
