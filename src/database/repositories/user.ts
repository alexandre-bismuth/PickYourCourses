import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';

/**
 * User data model
 */
export interface User {
  telegramId: string;
  email: string;
  isSuspended?: boolean;
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
   * Update user profile information
   */
  async updateProfile(telegramId: string, profile: {
    name?: string;
    promotion?: string;
  }): Promise<User> {
    const updates: Partial<User> = {
      ...profile,
      lastActive: new Date().toISOString()
    };

    return this.update(telegramId, updates);
  }

  /**
   * Get all admin users
   */
  async getAdmins(): Promise<User[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      FilterExpression: 'isAdmin = :isAdmin',
      ExpressionAttributeValues: {
        ':isAdmin': true
      }
    };

    const result = await this.documentClient.scan(params).promise();
    return result.Items as User[] || [];
  }

  protected buildKey(telegramId: string): any {
    return { telegramId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(telegramId)';
  }
}