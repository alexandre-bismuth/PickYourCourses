import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { ReviewRepository, Review, ReviewRatings } from '../database/repositories/review';
import { CourseRepository } from '../database/repositories/course';
import { UserRepository } from '../database/repositories/user';

/**
 * Review creation input
 */
export interface CreateReviewInput {
  userId: string;
  courseId: string;
  ratings: ReviewRatings;
  text?: string;
  anonymous?: boolean;
}

/**
 * Review update input
 */
export interface UpdateReviewInput {
  reviewId: string;
  userId: string;
  ratings: ReviewRatings;
  text?: string;
  anonymous?: boolean;
}

/**
 * Review validation error
 */
export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

/**
 * Review service with three-category rating system
 */
export class ReviewService {
  private reviewRepository: ReviewRepository;
  private courseRepository: CourseRepository;
  private userRepository: UserRepository;

  constructor(documentClient: DocumentClient) {
    this.reviewRepository = new ReviewRepository(documentClient);
    this.courseRepository = new CourseRepository(documentClient);
    this.userRepository = new UserRepository(documentClient);
  }

  /**
   * Create a new review with validation
   */
  async createReview(input: CreateReviewInput): Promise<Review> {
    // Validate input
    this.validateReviewInput(input);

    // Verify user exists (create if needed)
    await this.userRepository.getOrCreate(input.userId);

    // Verify course exists
    const course = await this.courseRepository.get(input.courseId);
    if (!course) {
      throw new ReviewValidationError('Course not found');
    }

    // Check if user already has a review for this course
    const existingReview = await this.reviewRepository.getUserReviewForCourse(
      input.userId,
      input.courseId
    );
    if (existingReview) {
      throw new ReviewValidationError('User already has a review for this course. Use updateReview instead.');
    }

    // Create the review
    const review = await this.reviewRepository.createReview(
      input.userId,
      input.courseId,
      input.ratings,
      input.text,
      input.anonymous || false
    );

    // Update course average ratings
    await this.updateCourseAverageRatings(input.courseId);

    return review;
  }

  /**
   * Update an existing review
   */
  async updateReview(input: UpdateReviewInput): Promise<Review> {
    // Validate input
    this.validateReviewInput(input);

    // Get existing review
    const existingReview = await this.reviewRepository.get(input.reviewId);
    if (!existingReview) {
      throw new ReviewValidationError('Review not found');
    }

    // Verify ownership
    if (existingReview.userId !== input.userId) {
      throw new ReviewValidationError('User can only update their own reviews');
    }

    // Verify review is not deleted
    if (existingReview.isDeleted) {
      throw new ReviewValidationError('Cannot update deleted review');
    }

    // Update the review
    const updatedReview = await this.reviewRepository.updateReview(
      input.reviewId,
      input.ratings,
      input.text,
      input.anonymous
    );

    // Update course average ratings
    await this.updateCourseAverageRatings(existingReview.courseId);

    return updatedReview;
  }

  /**
   * Get user's review for a specific course
   */
  async getUserReviewForCourse(userId: string, courseId: string): Promise<Review | null> {
    return this.reviewRepository.getUserReviewForCourse(userId, courseId);
  }

  /**
   * Get all reviews by a user
   */
  async getUserReviews(userId: string): Promise<Review[]> {
    return this.reviewRepository.getReviewsByUser(userId);
  }

  /**
   * Delete a review (soft delete)
   */
  async deleteReview(reviewId: string, userId: string): Promise<void> {
    // Get existing review
    const existingReview = await this.reviewRepository.get(reviewId);
    if (!existingReview) {
      throw new ReviewValidationError('Review not found');
    }

    // Verify ownership
    if (existingReview.userId !== userId) {
      throw new ReviewValidationError('User can only delete their own reviews');
    }

    // Verify review is not already deleted
    if (existingReview.isDeleted) {
      throw new ReviewValidationError('Review is already deleted');
    }

    // Delete the review
    await this.reviewRepository.deleteReview(reviewId);

    // Update course average ratings
    await this.updateCourseAverageRatings(existingReview.courseId);
  }

  /**
   * Check if user can review a course
   */
  async canUserReviewCourse(userId: string, courseId: string): Promise<{
    canReview: boolean;
    reason?: string;
    existingReview?: Review;
  }> {
    // Check if user exists (create if needed)
    await this.userRepository.getOrCreate(userId);

    // Check if course exists
    const course = await this.courseRepository.get(courseId);
    if (!course) {
      return { canReview: false, reason: 'Course not found' };
    }

    // Check if user already has a review
    const existingReview = await this.reviewRepository.getUserReviewForCourse(userId, courseId);
    if (existingReview) {
      return {
        canReview: false,
        reason: 'User already has a review for this course',
        existingReview
      };
    }

    return { canReview: true };
  }

  /**
   * Vote on a review
   */
  async voteOnReview(userId: string, reviewId: string, voteType: 'up' | 'down'): Promise<void> {
    // Verify user exists (create if needed)
    await this.userRepository.getOrCreate(userId);

    // Verify review exists and is not deleted
    const review = await this.reviewRepository.get(reviewId);
    if (!review) {
      throw new ReviewValidationError('Review not found');
    }
    if (review.isDeleted) {
      throw new ReviewValidationError('Cannot vote on deleted review');
    }

    // Prevent users from voting on their own reviews
    if (review.userId === userId) {
      throw new ReviewValidationError('Users cannot vote on their own reviews');
    }

    try {
      await this.reviewRepository.voteOnReview(userId, reviewId, voteType);
    } catch (error: any) {
      if (error.message === 'Vote removed') {
        // Vote was removed, this is expected behavior
        return;
      }
      throw error;
    }
  }

  /**
   * Get user's vote for a review
   */
  async getUserVoteForReview(userId: string, reviewId: string): Promise<'up' | 'down' | null> {
    return this.reviewRepository.getUserVoteForReview(userId, reviewId);
  }

  /**
   * Get reviews for a course with sorting and voting information
   */
  async getReviewsForCourse(
    courseId: string,
    sortBy: 'newest' | 'oldest' | 'upvotes' | 'rating' = 'upvotes'
  ): Promise<Review[]> {
    return this.reviewRepository.getReviewsForCourse(courseId, sortBy);
  }

  /**
   * Get vote counts for a specific review
   */
  async getVoteCountsForReview(reviewId: string): Promise<{ upvotes: number; downvotes: number }> {
    return this.reviewRepository.getVoteCounts(reviewId);
  }

  /**
   * Validate review input
   */
  private validateReviewInput(input: CreateReviewInput | UpdateReviewInput): void {
    // Validate ratings
    if (!input.ratings) {
      throw new ReviewValidationError('Ratings are required');
    }

    const { overall, quality, difficulty } = input.ratings;

    // Validate rating values (1-5)
    if (!this.isValidRating(overall)) {
      throw new ReviewValidationError('Overall rating must be between 1 and 5');
    }
    if (!this.isValidRating(quality)) {
      throw new ReviewValidationError('Quality rating must be between 1 and 5');
    }
    if (!this.isValidRating(difficulty)) {
      throw new ReviewValidationError('Difficulty rating must be between 1 and 5');
    }

    // Validate text length if provided
    if (input.text && input.text.length > 2000) {
      throw new ReviewValidationError('Review text cannot exceed 2000 characters');
    }

    // Validate text content (basic profanity/spam check)
    if (input.text && this.containsInappropriateContent(input.text)) {
      throw new ReviewValidationError('Review text contains inappropriate content');
    }
  }

  /**
   * Check if rating is valid (1-5)
   */
  private isValidRating(rating: number): boolean {
    return Number.isInteger(rating) && rating >= 1 && rating <= 5;
  }

  /**
   * Basic inappropriate content detection
   */
  private containsInappropriateContent(text: string): boolean {
    // Add content filter here later
    const words = text.toLowerCase().split(/\s+/);
    const wordCount = new Map<string, number>();

    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
    
    return false;
  }

  /**
   * Update course average ratings after review changes
   */
  private async updateCourseAverageRatings(courseId: string): Promise<void> {
    const { averageRatings, reviewCount } = await this.reviewRepository.calculateAverageRatings(courseId);

    await this.courseRepository.update(courseId, {
      averageRatings,
      reviewCount
    });
  }
}