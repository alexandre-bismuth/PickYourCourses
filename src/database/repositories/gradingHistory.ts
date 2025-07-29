import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';
import { v4 as uuidv4 } from 'uuid';

/**
 * Grading component
 */
export interface GradingComponent {
  name: string;
  percentage: number;
}

/**
 * Grading scheme history entry
 */
export interface GradingSchemeHistory {
  historyId: string;
  courseId: string;
  components: GradingComponent[];
  modifiedAt: string;
  modifiedBy: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  previousComponents?: GradingComponent[];
}

/**
 * Repository for managing grading scheme history
 */
export class GradingHistoryRepository extends AbstractRepository<GradingSchemeHistory, string> {
  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.GRADING_HISTORY);
  }

  /**
   * Create a new grading scheme history entry
   */
  async createHistoryEntry(
    courseId: string,
    components: GradingComponent[],
    modifiedBy: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    previousComponents?: GradingComponent[]
  ): Promise<GradingSchemeHistory> {
    const historyEntry: GradingSchemeHistory = {
      historyId: uuidv4(),
      courseId,
      components,
      modifiedAt: new Date().toISOString(),
      modifiedBy,
      action
    };

    if (previousComponents) {
      historyEntry.previousComponents = previousComponents;
    }

    return this.create(historyEntry);
  }

  /**
   * Get grading scheme history for a course
   */
  async getHistoryByCourse(courseId: string): Promise<GradingSchemeHistory[]> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'CourseIndex',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      ScanIndexForward: false // Sort by modifiedAt descending (newest first)
    };

    return this.query(params);
  }

  /**
   * Get recent grading scheme modifications across all courses
   */
  async getRecentModifications(limit: number = 50): Promise<GradingSchemeHistory[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      Limit: limit
    };

    const result = await this.documentClient.scan(params).promise();
    const items = result.Items as GradingSchemeHistory[] || [];

    // Sort by modifiedAt descending
    return items.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  }

  /**
   * Get modifications by a specific user
   */
  async getModificationsByUser(userId: string): Promise<GradingSchemeHistory[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      FilterExpression: 'modifiedBy = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    };

    const result = await this.documentClient.scan(params).promise();
    const items = result.Items as GradingSchemeHistory[] || [];

    // Sort by modifiedAt descending
    return items.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  }

  /**
   * Get statistics about grading scheme modifications
   */
  async getModificationStats(): Promise<{
    totalModifications: number;
    modificationsByAction: Record<string, number>;
    topModifiers: Array<{ userId: string; count: number }>;
  }> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName
    };

    const result = await this.documentClient.scan(params).promise();
    const items = result.Items as GradingSchemeHistory[] || [];

    const modificationsByAction: Record<string, number> = {};
    const modifierCounts: Record<string, number> = {};

    items.forEach(item => {
      // Count by action
      modificationsByAction[item.action] = (modificationsByAction[item.action] || 0) + 1;
      
      // Count by modifier
      modifierCounts[item.modifiedBy] = (modifierCounts[item.modifiedBy] || 0) + 1;
    });

    // Get top modifiers
    const topModifiers = Object.entries(modifierCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalModifications: items.length,
      modificationsByAction,
      topModifiers
    };
  }

  protected buildKey(historyId: string): any {
    return { historyId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(historyId)';
  }
}