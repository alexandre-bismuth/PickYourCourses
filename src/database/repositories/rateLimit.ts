import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { RateLimit } from '../../models';
import { TABLE_NAMES } from '../schemas';

/**
 * Repository for managing rate limit data
 */
export class RateLimitRepository extends AbstractRepository<RateLimit, string> {
  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.RATE_LIMITS);
  }

  /**
   * Build the primary key for rate limit operations
   */
  protected buildKey(userId: string): any {
    return { userId };
  }

  /**
   * Get the condition expression for create operations
   */
  protected getCreateCondition(): string {
    return 'attribute_not_exists(userId)';
  }

  /**
   * Get or create a rate limit record for a user
   */
  async getOrCreate(userId: string): Promise<RateLimit> {
    const existing = await this.get(userId);
    
    if (existing) {
      return existing;
    }

    // Create new rate limit record with current date
    const today = new Date().toISOString().split('T')[0]!; // YYYY-MM-DD format
    const now = new Date().toISOString();
    
    const newRateLimit: RateLimit = {
      userId,
      dailyCount: 0,
      totalCount: 0,
      lastResetDate: today,
      lastMessageTime: now
    };

    try {
      return await this.create(newRateLimit);
    } catch (error: any) {
      // Handle race condition - if another process created it, get the existing one
      if (error.message.includes('already exists')) {
        const existing = await this.get(userId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Increment message counts for a user
   */
  async incrementCounts(userId: string): Promise<RateLimit> {
    const today = new Date().toISOString().split('T')[0]!;
    const now = new Date().toISOString();
    
    // Get current record
    const current = await this.getOrCreate(userId);
    
    // Check if we need to reset daily count
    const needsReset = current.lastResetDate !== today;
    
    const updates: Partial<RateLimit> = {
      dailyCount: needsReset ? 1 : current.dailyCount + 1,
      totalCount: current.totalCount + 1,
      lastResetDate: today,
      lastMessageTime: now
    };

    return await this.update(userId, updates);
  }

  /**
   * Reset daily count for a user (used for testing or manual resets)
   */
  async resetDailyCount(userId: string): Promise<RateLimit> {
    const today = new Date().toISOString().split('T')[0]!;
    const now = new Date().toISOString();
    
    const updates: Partial<RateLimit> = {
      dailyCount: 0,
      lastResetDate: today,
      lastMessageTime: now
    };

    return await this.update(userId, updates);
  }
}