const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Chat completion via OpenRouter
async function chatCompletion(params) {
  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature || 0.7,
        max_tokens: params.max_tokens || 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    logger.error('OpenRouter chat completion failed', {
      model: params.model,
      error: error.message
    });
    throw new Error('OpenRouter API failed');
  }
}

// Transcribe audio via OpenRouter
async function transcribeAudio(formData) {
  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/audio/transcriptions`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );

    return response.data;
  } catch (error) {
    logger.error('OpenRouter audio transcription failed', {
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  chatCompletion,
  transcribeAudio
};
