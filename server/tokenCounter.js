const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/tokens.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class TokenCounter {
  constructor() {
    this.sessions = new Map();
    this.maxTokens = parseInt(process.env.MAX_CONTEXT_TOKENS || '200000');
    
    // Rough estimates for token counting
    // These are approximations - actual tokenization is more complex
    this.avgCharsPerToken = 4;
  }
  
  updateSession(sessionId, text, isInput = true) {
    if (!text) return null;
    
    const session = this.sessions.get(sessionId) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      messages: [],
      startTime: Date.now()
    };
    
    // Estimate tokens (rough approximation)
    const tokens = this.estimateTokens(text);
    
    if (isInput) {
      session.inputTokens += tokens;
    } else {
      session.outputTokens += tokens;
    }
    
    session.totalTokens = session.inputTokens + session.outputTokens;
    
    // Add to message history
    session.messages.push({
      text: text.substring(0, 100), // Store snippet only
      tokens,
      isInput,
      timestamp: Date.now()
    });
    
    // Trim old messages if exceeding limit
    if (session.totalTokens > this.maxTokens * 0.9) {
      this.trimSession(session);
    }
    
    this.sessions.set(sessionId, session);
    
    const usage = this.getUsage(sessionId);
    
    logger.debug('Token usage updated', {
      sessionId,
      tokens,
      isInput,
      usage
    });
    
    return usage;
  }
  
  estimateTokens(text) {
    // Simple estimation based on character count
    // Real tokenization would use a proper tokenizer
    const charCount = text.length;
    const wordCount = text.split(/\s+/).length;
    
    // Use a combination of character and word count for better estimation
    const charBasedTokens = Math.ceil(charCount / this.avgCharsPerToken);
    const wordBasedTokens = Math.ceil(wordCount * 1.3); // Words are roughly 1.3 tokens
    
    // Take the average for a balanced estimate
    return Math.ceil((charBasedTokens + wordBasedTokens) / 2);
  }
  
  trimSession(session) {
    // Remove oldest messages until under 80% of limit
    const targetTokens = this.maxTokens * 0.8;
    
    while (session.totalTokens > targetTokens && session.messages.length > 0) {
      const removed = session.messages.shift();
      
      if (removed.isInput) {
        session.inputTokens -= removed.tokens;
      } else {
        session.outputTokens -= removed.tokens;
      }
      
      session.totalTokens = session.inputTokens + session.outputTokens;
    }
    
    logger.info('Trimmed session to fit context window', {
      removedMessages: session.messages.length,
      newTotal: session.totalTokens
    });
  }
  
  getUsage(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        used: 0,
        total: this.maxTokens,
        percentage: 0,
        inputTokens: 0,
        outputTokens: 0
      };
    }
    
    const percentage = (session.totalTokens / this.maxTokens) * 100;
    
    return {
      used: session.totalTokens,
      total: this.maxTokens,
      percentage: Math.round(percentage * 10) / 10, // One decimal place
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      sessionDuration: Date.now() - session.startTime,
      messageCount: session.messages.length
    };
  }
  
  getAllUsage() {
    const usage = {};
    
    for (const [sessionId, _] of this.sessions) {
      usage[sessionId] = this.getUsage(sessionId);
    }
    
    return usage;
  }
  
  resetSession(sessionId) {
    this.sessions.delete(sessionId);
    logger.info('Reset token count for session', { sessionId });
  }
  
  // Get sessions approaching limit
  getHighUsageSessions(threshold = 80) {
    const highUsage = [];
    
    for (const [sessionId, _] of this.sessions) {
      const usage = this.getUsage(sessionId);
      if (usage.percentage >= threshold) {
        highUsage.push({
          sessionId,
          ...usage
        });
      }
    }
    
    return highUsage.sort((a, b) => b.percentage - a.percentage);
  }
  
  // Calculate burn rate (tokens per minute)
  getBurnRate(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.messages.length < 2) {
      return 0;
    }
    
    const duration = Date.now() - session.startTime;
    const minutes = duration / 60000;
    
    if (minutes < 1) {
      return 0; // Not enough data
    }
    
    return Math.round(session.totalTokens / minutes);
  }
  
  // Predict when session will hit limit
  predictLimitTime(sessionId) {
    const usage = this.getUsage(sessionId);
    const burnRate = this.getBurnRate(sessionId);
    
    if (burnRate === 0 || usage.percentage >= 100) {
      return null;
    }
    
    const remainingTokens = this.maxTokens - usage.used;
    const minutesRemaining = remainingTokens / burnRate;
    
    return {
      minutesRemaining: Math.round(minutesRemaining),
      predictedTime: new Date(Date.now() + minutesRemaining * 60000),
      burnRate,
      confidence: usage.messageCount > 10 ? 'high' : 'low'
    };
  }
}

module.exports = { TokenCounter };