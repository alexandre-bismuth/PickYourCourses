import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';

/**
 * User data model
 */
export interface User {
  telegramId: string;
  email: string;
  name?: string;
  promotion?: string;
  displayName?: string; // For reviews loaded from external data
  createdAt: string;
  lastActive: string;
}

/**
 * User repository
 */
export class UserRepository extends AbstractRepository<User, string> {
  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.USERS);
  }

  /**
   * Find user by email address
   */
  async findByEmail(email: string): Promise<User | null> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    };

    const result = await this.query(params);
    return result.length > 0 ? (result[0] || null) : null;
  }

  /**
   * Update last active timestamp
   */
  async updateLastActive(telegramId: string): Promise<User> {
    return this.update(telegramId, {
      lastActive: new Date().toISOString()
    });
  }

  /**
   * Get or create a user record
   */
  async getOrCreate(telegramId: string, email?: string): Promise<User> {
    const existing = await this.get(telegramId);
    if (existing) {
      return existing;
    }

    // Create new user
    const newUser: User = {
      telegramId,
      email: email || `${telegramId}@telegram.local`, // Default email if not provided
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    return this.create(newUser);
  }

  /**
   * Update user profile information
   */
  async updateProfile(telegramId: string, profile: {
    name?: string;
    promotion?: string;
  }): Promise<User> {
    const updates: Partial<User> = {
      lastActive: new Date().toISOString()
    };

    if (profile.name !== undefined) {
      updates.name = profile.name;
    }
    if (profile.promotion !== undefined) {
      updates.promotion = profile.promotion;
    }

    return this.update(telegramId, updates);
  }

  protected buildKey(telegramId: string): any {
    return { telegramId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(telegramId)';
  }
}