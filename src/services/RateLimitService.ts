import { RateLimitRepository } from '../database/repositories/rateLimit';
import { RateLimit } from '../models';

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  dailyLimit: number;
  totalLimit: number;
}

/**
 * Default rate limiting configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  dailyLimit: 100,
  totalLimit: 3000
};

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  dailyCount: number;
  totalCount: number;
  dailyLimit: number;
  totalLimit: number;
  resetTime?: Date;
}

/**
 * Service for managing rate limiting functionality
 */
export class RateLimitService {
  private rateLimitRepository: RateLimitRepository;
  private config: RateLimitConfig;

  constructor(
    rateLimitRepository: RateLimitRepository,
    config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
  ) {
    this.rateLimitRepository = rateLimitRepository;
    this.config = config;
  }

  /**
   * Check if a user is allowed to send a message
   */
  async checkRateLimit(userId: string): Promise<RateLimitResult> {
    // Get current rate limit data
    const rateLimit = await this.rateLimitRepository.getOrCreate(userId);

    // Check if daily count needs to be reset
    const today = new Date().toISOString().split('T')[0]!;
    const needsReset = rateLimit.lastResetDate !== today;

    const currentDailyCount = needsReset ? 0 : rateLimit.dailyCount;
    const currentTotalCount = rateLimit.totalCount;

    // Check daily limit
    if (currentDailyCount >= this.config.dailyLimit) {
      const resetTime = this.getNextMidnightUTC();
      return {
        allowed: false,
        reason: `Daily message limit of ${this.config.dailyLimit} exceeded. Limit resets at midnight UTC.`,
        dailyCount: currentDailyCount,
        totalCount: currentTotalCount,
        dailyLimit: this.config.dailyLimit,
        totalLimit: this.config.totalLimit,
        resetTime
      };
    }

    // Check total limit
    if (currentTotalCount >= this.config.totalLimit) {
      return {
        allowed: false,
        reason: `Total message limit of ${this.config.totalLimit} exceeded. This is a lifetime limit.`,
        dailyCount: currentDailyCount,
        totalCount: currentTotalCount,
        dailyLimit: this.config.dailyLimit,
        totalLimit: this.config.totalLimit
      };
    }

    // User is within limits
    return {
      allowed: true,
      dailyCount: currentDailyCount,
      totalCount: currentTotalCount,
      dailyLimit: this.config.dailyLimit,
      totalLimit: this.config.totalLimit
    };
  }

  /**
   * Record a message from a user (increment counters)
   */
  async recordMessage(userId: string): Promise<RateLimit> {
    return await this.rateLimitRepository.incrementCounts(userId);
  }

  /**
   * Get current rate limit status for a user
   */
  async getRateLimitStatus(userId: string): Promise<RateLimitResult> {
    return await this.checkRateLimit(userId);
  }

  /**
   * Reset daily count for a user
   */
  async resetDailyCount(userId: string): Promise<RateLimit> {
    return await this.rateLimitRepository.resetDailyCount(userId);
  }

  /**
   * Get the next midnight UTC time for reset calculation
   */
  private getNextMidnightUTC(): Date {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCDate(now.getUTCDate() + 1);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    return nextMidnight;
  }

  /**
   * Get daily message count for a user
   */
  async getDailyCount(userId: string): Promise<number> {
    const rateLimit = await this.rateLimitRepository.getOrCreate(userId);
    const today = new Date().toISOString().split('T')[0]!;
    const needsReset = rateLimit.lastResetDate !== today;

    return needsReset ? 0 : rateLimit.dailyCount;
  }

  /**
   * Get total message count for a user
   */
  async getTotalCount(userId: string): Promise<number> {
    const rateLimit = await this.rateLimitRepository.getOrCreate(userId);
    return rateLimit.totalCount;
  }
}