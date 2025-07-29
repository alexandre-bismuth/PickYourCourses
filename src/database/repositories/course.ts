import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';

/**
 * Grading scheme component
 */
export interface GradingComponent {
  name: string;
  percentage: number;
}

/**
 * Grading scheme with history
 */
export interface GradingScheme {
  components: GradingComponent[];
  lastModified: string;
  modifiedBy: string;
}

/**
 * Average ratings for a course
 */
export interface AverageRatings {
  overall: number;
  quality: number;
  difficulty: number;
}

/**
 * Course data model
 */
export interface Course {
  courseId: string;
  category: string;
  name: string;
  description?: string;
  gradingScheme: GradingScheme;
  averageRatings: AverageRatings;
  reviewCount: number;
}

/**
 * Course repository with category filtering and average rating calculations
 */
export class CourseRepository extends AbstractRepository<Course, string> {
  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.COURSES);
  }

  /**
   * Get courses by category
   */
  async getCoursesByCategory(category: string): Promise<Course[]> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'category = :category',
      ExpressionAttributeValues: {
        ':category': category
      }
    };

    return this.query(params);
  }

  /**
   * Get all categories with course counts
   */
  async getCategoriesWithCounts(): Promise<Array<{ category: string; count: number }>> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      ProjectionExpression: 'category'
    };

    const result = await this.documentClient.scan(params).promise();
    
    // Count courses by category
    const categoryCounts: Record<string, number> = {};
    result.Items?.forEach(item => {
      const category = item['category'] as string;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    return Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      count
    }));
  }

  /**
   * Update course average ratings
   */
  async updateAverageRatings(courseId: string, ratings: AverageRatings, reviewCount: number): Promise<Course> {
    return this.update(courseId, {
      averageRatings: ratings,
      reviewCount
    });
  }

  /**
   * Update grading scheme
   */
  async updateGradingScheme(courseId: string, scheme: GradingComponent[], modifiedBy: string): Promise<Course> {
    // Validate that percentages sum to 100
    const totalPercentage = scheme.reduce((sum, component) => sum + component.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw new Error('Grading scheme percentages must sum to 100%');
    }

    const gradingScheme: GradingScheme = {
      components: scheme,
      lastModified: new Date().toISOString(),
      modifiedBy
    };

    return this.update(courseId, { gradingScheme });
  }

  /**
   * Get grading scheme history for a course
   */
  async getGradingHistory(courseId: string): Promise<GradingScheme[]> {
    // For now, we only store the current grading scheme
    // In a full implementation, we might have a separate table for history
    const course = await this.get(courseId);
    return course ? [course.gradingScheme] : [];
  }

  /**
   * Search courses by name or course ID
   */
  async searchCourses(searchTerm: string): Promise<Course[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      FilterExpression: 'contains(#name, :searchTerm) OR contains(courseId, :searchTerm)',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':searchTerm': searchTerm
      }
    };

    const result = await this.documentClient.scan(params).promise();
    return result.Items as Course[] || [];
  }

  /**
   * Get courses with highest ratings
   */
  async getTopRatedCourses(limit: number = 10): Promise<Course[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName,
      FilterExpression: 'reviewCount > :minReviews',
      ExpressionAttributeValues: {
        ':minReviews': 3 // Minimum 3 reviews to be considered
      }
    };

    const result = await this.documentClient.scan(params).promise();
    const courses = result.Items as Course[] || [];

    // Sort by overall rating and return top courses
    return courses
      .sort((a, b) => b.averageRatings.overall - a.averageRatings.overall)
      .slice(0, limit);
  }

  /**
   * Get courses with most reviews
   */
  async getMostReviewedCourses(limit: number = 10): Promise<Course[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName
    };

    const result = await this.documentClient.scan(params).promise();
    const courses = result.Items as Course[] || [];

    // Sort by review count and return top courses
    return courses
      .sort((a, b) => b.reviewCount - a.reviewCount)
      .slice(0, limit);
  }

  protected buildKey(courseId: string): any {
    return { courseId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(courseId)';
  }
}