import { DocumentClient } from 'aws-sdk/clients/dynamodb';

/**
 * Base repository interface with common CRUD operations
 */
export interface BaseRepository<T, K> {
  /**
   * Create a new item
   */
  create(item: T): Promise<T>;

  /**
   * Get an item by its key
   */
  get(key: K): Promise<T | null>;

  /**
   * Update an existing item
   */
  update(key: K, updates: Partial<T>): Promise<T>;

  /**
   * Delete an item by its key
   */
  delete(key: K): Promise<void>;

  /**
   * List items with optional filtering
   */
  list(options?: ListOptions): Promise<T[]>;
}

/**
 * Options for listing items
 */
export interface ListOptions {
  limit?: number;
  lastEvaluatedKey?: any;
  filter?: any;
}

/**
 * Abstract base repository implementation
 */
export abstract class AbstractRepository<T extends DocumentClient.AttributeMap, K> implements BaseRepository<T, K> {
  protected documentClient: DocumentClient;
  protected tableName: string;

  constructor(documentClient: DocumentClient, tableName: string) {
    this.documentClient = documentClient;
    this.tableName = tableName;
  }

  /**
   * Create a new item
   */
  async create(item: T): Promise<T> {
    const params: DocumentClient.PutItemInput = {
      TableName: this.tableName,
      Item: item,
      ConditionExpression: this.getCreateCondition(),
      ReturnValues: 'ALL_OLD'
    };

    try {
      await this.documentClient.put(params).promise();
      return item;
    } catch (error: any) {
      if (error.code === 'ConditionalCheckFailedException') {
        throw new Error(`Item already exists`);
      }
      throw error;
    }
  }

  /**
   * Get an item by its key
   */
  async get(key: K): Promise<T | null> {
    const params: DocumentClient.GetItemInput = {
      TableName: this.tableName,
      Key: this.buildKey(key)
    };

    const result = await this.documentClient.get(params).promise();
    return result.Item as T || null;
  }

  /**
   * Update an existing item
   */
  async update(key: K, updates: Partial<T>): Promise<T> {
    const updateExpression = this.buildUpdateExpression(updates);
    const expressionAttributeNames = this.buildExpressionAttributeNames(updates);
    const expressionAttributeValues = this.buildExpressionAttributeValues(updates);

    const params: DocumentClient.UpdateItemInput = {
      TableName: this.tableName,
      Key: this.buildKey(key),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await this.documentClient.update(params).promise();
    return result.Attributes as T;
  }

  /**
   * Delete an item by its key
   */
  async delete(key: K): Promise<void> {
    const params: DocumentClient.DeleteItemInput = {
      TableName: this.tableName,
      Key: this.buildKey(key)
    };

    await this.documentClient.delete(params).promise();
  }

  /**
   * List items with optional filtering
   */
  async list(options: ListOptions = {}): Promise<T[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName
    };

    if (options.limit !== undefined) {
      params.Limit = options.limit;
    }

    if (options.lastEvaluatedKey !== undefined) {
      params.ExclusiveStartKey = options.lastEvaluatedKey;
    }

    if (options.filter) {
      params.FilterExpression = options.filter.expression;
      params.ExpressionAttributeNames = options.filter.attributeNames;
      params.ExpressionAttributeValues = options.filter.attributeValues;
    }

    const result = await this.documentClient.scan(params).promise();
    return result.Items as T[] || [];
  }

  /**
   * Query items using a GSI or primary key
   */
  protected async query(params: DocumentClient.QueryInput): Promise<T[]> {
    const result = await this.documentClient.query(params).promise();
    return result.Items as T[] || [];
  }

  /**
   * Build the primary key for DynamoDB operations
   */
  protected abstract buildKey(key: K): any;

  /**
   * Get the condition expression for create operations
   */
  protected abstract getCreateCondition(): string;

  /**
   * Build update expression from partial updates
   */
  private buildUpdateExpression(updates: Partial<T>): string {
    const setExpressions: string[] = [];
    
    Object.keys(updates).forEach(key => {
      setExpressions.push(`#${key} = :${key}`);
    });

    return `SET ${setExpressions.join(', ')}`;
  }

  /**
   * Build expression attribute names
   */
  private buildExpressionAttributeNames(updates: Partial<T>): Record<string, string> {
    const attributeNames: Record<string, string> = {};
    
    Object.keys(updates).forEach(key => {
      attributeNames[`#${key}`] = key;
    });

    return attributeNames;
  }

  /**
   * Build expression attribute values
   */
  private buildExpressionAttributeValues(updates: Partial<T>): Record<string, any> {
    const attributeValues: Record<string, any> = {};
    
    Object.entries(updates).forEach(([key, value]) => {
      attributeValues[`:${key}`] = value;
    });

    return attributeValues;
  }
}