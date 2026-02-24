import process from 'node:process'
import 'dotenv/config';
import {Ollama} from 'ollama'

// inspired by "https://github.com/ollama/ollama-js"
const ollama = new Ollama({
    host: 'https://ollama.com',
    headers: {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY},
})

export const ollamaResume = async (text) => {
    return await ollama.chat({
        model: "gpt-oss:20b",
        messages: [
            {
                role: "system",
                content: `You are an expert of text resume. Extract information accurately.
                        Rules:
                        - It must be normal readable text with 1 or 2 paragraphs maximum
                        - The resume must be between 150 and 250 words
                        - Normalize dates to DD.MM.YYYY format`
            },
            {
                role: "user",
                content: `Parse this resume.

                        RESUME TEXT:
                        ${text}`
            }
        ],
        format: "json",
        options: {
            temperature: 0.1
        }
    });
}
