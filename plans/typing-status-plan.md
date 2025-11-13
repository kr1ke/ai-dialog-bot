# Telegram Typing Status Implementation Plan

## 📋 Overview

Add native Telegram typing status using `bot.sendChatAction(chatId, 'typing')` to provide visual feedback when the bot processes AI requests. Simple implementation with minimal code changes.

## 🎯 Objective

Show "bot is typing..." indicator during all AI processing operations:
- Text analysis via OpenRouter API
- Image analysis via OpenRouter Vision API  
- Voice transcription via OpenRouter Audio API

## 🔧 Technical Details

### Library & Method
- **Library**: `node-telegram-bot-api` v0.66.0
- **Method**: `bot.sendChatAction(chatId, 'typing')`
- **Timeout**: 5 seconds maximum per Telegram
- **Strategy**: Single call before each async operation (no intervals)

### Implementation Pattern
```javascript
// Just add this line before each async operation:
await bot.sendChatAction(chatId, 'typing');
```

## 📍 Integration Points

### 1. Text Processor (`src/processors/text.js`)

**Current Code (line 56):**
```javascript
const response = await openrouter.chatCompletion({
  model: config.TEXT_MODEL,
  messages: [
    { role: 'system', content: 'Ты помогаешь в переписках' },
    { role: 'user', content: prompt }
  ]
});
```

**After Integration:**
```javascript
await bot.sendChatAction(userId, 'typing');
const response = await openrouter.chatCompletion({
  model: config.TEXT_MODEL,
  messages: [
    { role: 'system', content: 'Ты помогаешь в переписках' },
    { role: 'user', content: prompt }
  ]
});
```

**Function Signature Change:**
```javascript
// Before:
async function processContext(messages, instruction, userId)

// After:
async function processContext(bot, messages, instruction, userId)
```

### 2. Vision Processor (`src/processors/vision.js`)

**Current Code (line 13):**
```javascript
const response = await openrouter.chatCompletion({
  model: config.VISION_MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Опиши изображение кратко на русском (1-2 предложения)' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
      ]
    }
  ]
});
```

**After Integration:**
```javascript
await bot.sendChatAction(userId, 'typing');
const response = await openrouter.chatCompletion({
  model: config.VISION_MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Опиши изображение кратко на русском (1-2 предложения)' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
      ]
    }
  ]
});
```

**Function Signature Change:**
```javascript
// Before:
async function analyzeImage(bot, fileId)

// After:
async function analyzeImage(bot, fileId, userId)
```

### 3. Voice Processor (`src/processors/voice.js`)

**Current Code (line 20):**
```javascript
const response = await openrouter.transcribeAudio(formData);
```

**After Integration:**
```javascript
await bot.sendChatAction(userId, 'typing');
const response = await openrouter.transcribeAudio(formData);
```

**Function Signature Change:**
```javascript
// Before:
async function transcribe(bot, fileId)

// After:
async function transcribe(bot, fileId, userId)
```

## 🔄 Handler Updates (`src/handlers.js`)

### Required Changes:

1. **Line 73**: Image analysis
```javascript
// Before:
const description = await visionProcessor.analyzeImage(bot, fileId);

// After:
const description = await visionProcessor.analyzeImage(bot, fileId, userId);
```

2. **Line 79**: Voice transcription
```javascript
// Before:
const transcription = await voiceProcessor.transcribe(bot, msg.voice.file_id);

// After:
const transcription = await voiceProcessor.transcribe(bot, msg.voice.file_id, userId);
```

3. **Line 131-135**: Custom text requests
```javascript
// Before:
const { result, metadata } = await textProcessor.processContext(
  session.messages,
  msg.text,
  userId
);

// After:
const { result, metadata } = await textProcessor.processContext(
  bot,
  session.messages,
  msg.text,
  userId
);
```

4. **Line 189-193**: Button actions (summary, formal, friendly)
```javascript
// Before:
const { result, metadata } = await textProcessor.processContext(
  session.messages,
  action,
  userId
);

// After:
const { result, metadata } = await textProcessor.processContext(
  bot,
  session.messages,
  action,
  userId
);
```

5. **Line 241-245**: Regenerate responses
```javascript
// Before:
const { result, metadata } = await textProcessor.processContext(
  session.messages,
  session.last_instruction,
  userId
);

// After:
const { result, metadata } = await textProcessor.processContext(
  bot,
  session.messages,
  session.last_instruction,
  userId
);
```

## 📁 Files to Modify

### Modified Files Only
1. `src/processors/text.js` - Add typing before OpenRouter API call
2. `src/processors/vision.js` - Add typing before OpenRouter Vision API call  
3. `src/processors/voice.js` - Add typing before OpenRouter Audio API call
4. `src/handlers.js` - Update all processor calls to pass bot parameter

### No New Files Created

## 🛠️ Implementation Steps

### Step 1: Update Text Processor
1. Add `bot` parameter to `processContext()` function
2. Add `await bot.sendChatAction(userId, 'typing');` before OpenRouter call
3. Update function documentation

### Step 2: Update Vision Processor
1. Add `userId` parameter to `analyzeImage()` function
2. Add `await bot.sendChatAction(userId, 'typing');` before OpenRouter call
3. Update function documentation

### Step 3: Update Voice Processor
1. Add `userId` parameter to `transcribe()` function
2. Add `await bot.sendChatAction(userId, 'typing');` before OpenRouter call
3. Update function documentation

### Step 4: Update Handlers
1. Update all 5 processor calls in handlers.js to pass bot parameter
2. Verify error handling remains intact

## ⚠️ Error Handling

### Simple Approach
- **No special error handling for typing status**
- If `sendChatAction` fails, ignore and continue with operation
- Existing error handling patterns remain unchanged
- No impact on existing functionality

### Implementation
```javascript
try {
  await bot.sendChatAction(userId, 'typing');
} catch (error) {
  // Ignore - typing failures are non-critical
}
```

## 📊 Success Criteria

### Functional Requirements
- [ ] Typing status appears before all AI processing operations
- [ ] All existing functionality works unchanged
- [ ] No performance impact
- [ ] Clean, maintainable code

### Non-Functional Requirements
- [ ] Minimal code changes
- [ ] No new files
- [ ] No complex error handling
- [ ] Easy to understand and maintain

## 🧪 Testing Scenarios

### Basic Functionality
1. **Text Processing**: Send custom request → verify typing appears → response sent
2. **Image Analysis**: Forward image → verify typing during analysis → confirmation sent
3. **Voice Transcription**: Forward voice → verify typing during transcription → confirmation sent
4. **Button Actions**: Click summary/formal/friendly → verify typing → response sent
5. **Regenerate**: Click regenerate → verify typing → new response sent

### Error Scenarios
1. **sendChatAction Fails**: Operation continues normally
2. **OpenRouter API Fails**: Existing error handling works
3. **Network Issues**: Existing error handling works

## 📈 Performance Considerations

### Impact Analysis
- **Network**: One additional API call per operation
- **CPU**: Minimal impact
- **Memory**: No additional memory usage
- **User Experience**: Significant improvement

## 📝 Checklist

### Pre-Implementation
- [ ] Review current processor function signatures
- [ ] Identify all processor call sites in handlers.js
- [ ] Plan parameter order changes

### Implementation
- [ ] Update text processor with typing status
- [ ] Update vision processor with typing status
- [ ] Update voice processor with typing status
- [ ] Update all processor calls in handlers.js
- [ ] Test all integration points

### Post-Implementation
- [ ] Verify typing status works for all operation types
- [ ] Test error scenarios
- [ ] Monitor performance impact

---

**This is the simplest possible implementation - just one line of code per operation, no new files, no utilities, no intervals. Maximum simplicity with minimum code changes.**
