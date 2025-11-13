const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Chat completion via OpenRouter
async function chatCompletion(params) {
  try {
    const requestBody = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature || 0.7,
      max_tokens: params.max_tokens || 1000
    };

    // Support for multimodal content (images/audio)
    // Gemini accepts messages with content array instead of plain text
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      requestBody,
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

module.exports = {
  chatCompletion
};
