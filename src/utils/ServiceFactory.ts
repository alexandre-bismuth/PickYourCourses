import { WebhookHandler } from '../handlers/WebhookHandler';
import { RateLimitService } from '../services/RateLimitService';
import { StateManager } from '../services/StateManager';
import { ReviewService } from '../services/ReviewService';
import { CourseService } from '../services/CourseService';
import { DynamoDBClient } from '../database';
import TelegramBot from 'node-telegram-bot-api';

// Import individual repositories
import { RateLimitRepository } from '../database/repositories/rateLimit';

export interface ServiceContainer {
    webhookHandler: WebhookHandler;
    rateLimitService: RateLimitService;
    stateManager: StateManager;
    reviewService: ReviewService;
    courseService: CourseService;
    bot: TelegramBot;
}

export class ServiceFactory {
    private static services: ServiceContainer | null = null;

    /**
     * Create and initialize all services with proper dependency injection
     */
    static async createServices(): Promise<ServiceContainer> {
        // Return cached services if already initialized (for Lambda container reuse)
        if (this.services) {
            console.log('Returning cached services');
            return this.services;
        }

        console.log('Initializing services...');

        try {
            // Validate required environment variables
            const botToken = process.env['TELEGRAM_BOT_TOKEN'];
            if (!botToken) {
                throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
            }

            console.log('Environment variables validated');

            // Initialize database client
            const dbClient = DynamoDBClient.getInstance();
            const documentClient = dbClient.getDocumentClient();

            console.log('Database client initialized');

            // Initialize repositories
            const rateLimitRepository = new RateLimitRepository(documentClient);

            console.log('Repositories initialized');

            // Initialize Telegram Bot
            const bot = new TelegramBot(botToken);

            console.log('Telegram bot initialized');

            // Initialize services with proper dependencies
            const rateLimitService = new RateLimitService(rateLimitRepository);
            const stateManager = new StateManager();
            const reviewService = new ReviewService(documentClient);
            const courseService = new CourseService(documentClient);

            console.log('Core services initialized');

            // Initialize WebhookHandler with all required dependencies
            const webhookHandler = new WebhookHandler(
                botToken,
                rateLimitService,
                stateManager,
                reviewService,
                courseService,
                bot
            );

            console.log('WebhookHandler initialized');

            // Cache the services for container reuse
            this.services = {
                webhookHandler,
                rateLimitService,
                stateManager,
                reviewService,
                courseService,
                bot
            };

            console.log('Services cached and ready');

            return this.services;
        } catch (error) {
            console.error('Service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Reset services (useful for testing)
     */
    static resetServices(): void {
        this.services = null;
    }
}
