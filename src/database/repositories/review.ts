import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';
import { VoteRepository } from './vote';

/**
 * Review ratings
 */
export interface ReviewRatings {
  overall: number;
  quality: number;
  difficulty: number;
}

/**
 * Review data model
 */
export interface Review {
  reviewId: string;
  courseId: string;
  userId: string;
  ratings: ReviewRatings;
  text?: string;
  anonymous: boolean;
  upvotes: number;
  downvotes: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

/**
 * Review with vote counts
 */
export interface ReviewWithVotes extends Review {
  netVotes: number;
}

/**
 * Review repository with voting and sorting capabilities
 */
export class ReviewRepository extends AbstractRepository<Review, string> {
  private voteRepository: VoteRepository;

  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.REVIEWS);
    this.voteRepository = new VoteRepository(documentClient);
  }

  /**
   * Get reviews for a course with sorting options
   */
  async getReviewsForCourse(
    courseId: string, 
    sortBy: 'newest' | 'oldest' | 'upvotes' | 'rating' = 'upvotes'
  ): Promise<ReviewWithVotes[]> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'CourseIndex',
      KeyConditionExpression: 'courseId = :courseId',
      FilterExpression: 'isDeleted = :isDeleted',
      ExpressionAttributeValues: {
        ':courseId': courseId,
        ':isDeleted': false
      }
    };

    const reviews = await this.query(params);
    
    // Get vote counts for all reviews
    const reviewIds = reviews.map(review => review.reviewId);
    const voteCounts = await this.voteRepository.getVoteCountsForReviews(reviewIds);
    
    // Add vote counts and calculate net votes
    const reviewsWithVotes: ReviewWithVotes[] = reviews.map(review => ({
      ...review,
      upvotes: voteCounts[review.reviewId]?.upvotes || 0,
      downvotes: voteCounts[review.reviewId]?.downvotes || 0,
      netVotes: (voteCounts[review.reviewId]?.upvotes || 0) - (voteCounts[review.reviewId]?.downvotes || 0)
    }));

    // Sort reviews based on the specified criteria
    return this.sortReviews(reviewsWithVotes, sortBy);
  }

  /**
   * Get reviews by user
   */
  async getReviewsByUser(userId: string): Promise<Review[]> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'isDeleted = :isDeleted',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':isDeleted': false
      }
    };

    return this.query(params);
  }

  /**
   * Get user's review for a specific course
   */
  async getUserReviewForCourse(userId: string, courseId: string): Promise<Review | null> {
    const userReviews = await this.getReviewsByUser(userId);
    return userReviews.find(review => review.courseId === courseId) || null;
  }

  /**
   * Create a new review
   */
  async createReview(
    userId: string,
    courseId: string,
    ratings: ReviewRatings,
    text?: string,
    anonymous: boolean = false
  ): Promise<Review> {
    // Check if user already has a review for this course
    const existingReview = await this.getUserReviewForCourse(userId, courseId);
    if (existingReview) {
      throw new Error('User already has a review for this course');
    }

    const review: Review = {
      reviewId: this.generateReviewId(),
      courseId,
      userId,
      ratings,
      ...(text && { text }),
      anonymous,
      upvotes: 0,
      downvotes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false
    };

    return this.create(review);
  }

  /**
   * Update an existing review
   */
  async updateReview(
    reviewId: string,
    ratings: ReviewRatings,
    text?: string,
    anonymous?: boolean
  ): Promise<Review> {
    const updates: Partial<Review> = {
      ratings,
      updatedAt: new Date().toISOString()
    };

    if (text !== undefined) {
      if (text) {
        updates.text = text;
      }
      // If text is empty string, we don't add it to updates, effectively removing it
    }

    if (anonymous !== undefined) {
      updates.anonymous = anonymous;
    }

    return this.update(reviewId, updates);
  }

  /**
   * Soft delete a review
   */
  async deleteReview(reviewId: string): Promise<void> {
    await this.update(reviewId, {
      isDeleted: true,
      updatedAt: new Date().toISOString()
    });

    // Remove all votes for this review
    await this.voteRepository.removeVotesForReview(reviewId);
  }

  /**
   * Vote on a review
   */
  async voteOnReview(userId: string, reviewId: string, voteType: 'up' | 'down'): Promise<{ action: 'created' | 'updated' | 'removed'; vote?: any }> {
    return await this.voteRepository.castVote(userId, reviewId, voteType);
  }

  /**
   * Get user's vote for a review
   */
  async getUserVoteForReview(userId: string, reviewId: string): Promise<'up' | 'down' | null> {
    const vote = await this.voteRepository.getUserVote(userId, reviewId);
    return vote?.voteType || null;
  }

  /**
   * Get vote counts for a specific review
   */
  async getVoteCounts(reviewId: string): Promise<{ upvotes: number; downvotes: number }> {
    return this.voteRepository.getVoteCounts(reviewId);
  }

  /**
   * Calculate average ratings for a course
   */
  async calculateAverageRatings(courseId: string): Promise<{
    averageRatings: ReviewRatings;
    reviewCount: number;
  }> {
    const reviews = await this.getReviewsForCourse(courseId);
    
    if (reviews.length === 0) {
      return {
        averageRatings: { overall: 0, quality: 0, difficulty: 0 },
        reviewCount: 0
      };
    }

    const totals = reviews.reduce(
      (acc, review) => ({
        overall: acc.overall + review.ratings.overall,
        quality: acc.quality + review.ratings.quality,
        difficulty: acc.difficulty + review.ratings.difficulty
      }),
      { overall: 0, quality: 0, difficulty: 0 }
    );

    const count = reviews.length;
    
    return {
      averageRatings: {
        overall: Math.round((totals.overall / count) * 10) / 10,
        quality: Math.round((totals.quality / count) * 10) / 10,
        difficulty: Math.round((totals.difficulty / count) * 10) / 10
      },
      reviewCount: count
    };
  }

  /**
   * Get all reviews (admin function)
   */
  async getAllReviews(includeDeleted: boolean = false): Promise<Review[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.tableName
    };

    if (!includeDeleted) {
      params.FilterExpression = 'isDeleted = :isDeleted';
      params.ExpressionAttributeValues = {
        ':isDeleted': false
      };
    }

    const result = await this.documentClient.scan(params).promise();
    return result.Items as Review[] || [];
  }

  /**
   * Sort reviews based on criteria
   */
  private sortReviews(reviews: ReviewWithVotes[], sortBy: string): ReviewWithVotes[] {
    switch (sortBy) {
      case 'newest':
        return reviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'oldest':
        return reviews.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'upvotes':
        return reviews.sort((a, b) => b.netVotes - a.netVotes);
      case 'rating':
        return reviews.sort((a, b) => b.ratings.overall - a.ratings.overall);
      default:
        return reviews;
    }
  }

  /**
   * Generate a unique review ID
   */
  private generateReviewId(): string {
    return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  protected buildKey(reviewId: string): any {
    return { reviewId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(reviewId)';
  }
}