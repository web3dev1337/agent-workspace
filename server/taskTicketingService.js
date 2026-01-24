const winston = require('winston');
const { TTLCache } = require('./utils/ttlCache');
const { TrelloTaskProvider } = require('./taskProviders/trelloProvider');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/tasks.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class TaskTicketingService {
  constructor() {
    this.cache = new TTLCache({ defaultTtlMs: 30_000, maxEntries: 500 });
    this.providers = new Map();

    const trello = new TrelloTaskProvider({ cache: this.cache, logger });
    this.providers.set(trello.id, trello);
  }

  static getInstance() {
    if (!TaskTicketingService.instance) {
      TaskTicketingService.instance = new TaskTicketingService();
    }
    return TaskTicketingService.instance;
  }

  listProviders() {
    const providers = [];
    for (const provider of this.providers.values()) {
      providers.push({
        id: provider.id,
        label: provider.label,
        configured: provider.isConfigured(),
        capabilities: provider.getCapabilities()
      });
    }
    return providers;
  }

  getProvider(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      const err = new Error(`Unknown task provider: ${providerId}`);
      err.code = 'UNKNOWN_PROVIDER';
      throw err;
    }
    if (!provider.isConfigured()) {
      const err = new Error(`${provider.label} is not configured`);
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }
    return provider;
  }
}

module.exports = { TaskTicketingService };

