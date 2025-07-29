import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { AbstractRepository } from './base';
import { TABLE_NAMES } from '../schemas';

/**
 * Vote data model
 */
export interface Vote {
  voteId: string;
  reviewId: string;
  userId: string;
  voteType: 'up' | 'down';
  createdAt: string;
}

/**
 * Vote repository for managing review votes
 */
export class VoteRepository extends AbstractRepository<Vote, string> {
  constructor(documentClient: DocumentClient) {
    super(documentClient, TABLE_NAMES.VOTES);
  }

  /**
   * Get user's vote for a specific review
   */
  async getUserVote(userId: string, reviewId: string): Promise<Vote | null> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'UserReviewIndex',
      KeyConditionExpression: 'userId = :userId AND reviewId = :reviewId',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':reviewId': reviewId
      }
    };

    const result = await this.query(params);
    return result.length > 0 ? result[0]! : null;
  }

  /**
   * Get all votes for a review
   */
  async getVotesForReview(reviewId: string): Promise<Vote[]> {
    const params: DocumentClient.QueryInput = {
      TableName: this.tableName,
      IndexName: 'ReviewIndex',
      KeyConditionExpression: 'reviewId = :reviewId',
      ExpressionAttributeValues: {
        ':reviewId': reviewId
      }
    };

    return this.query(params);
  }

  /**
   * Cast or update a vote
   */
  async castVote(userId: string, reviewId: string, voteType: 'up' | 'down'): Promise<Vote> {
    // Check if user already voted
    const existingVote = await this.getUserVote(userId, reviewId);
    
    if (existingVote) {
      // Update existing vote
      if (existingVote.voteType === voteType) {
        // Same vote type, remove the vote
        await this.delete(existingVote.voteId);
        throw new Error('Vote removed');
      } else {
        // Different vote type, update it
        return this.update(existingVote.voteId, { voteType });
      }
    } else {
      // Create new vote
      const vote: Vote = {
        voteId: this.generateVoteId(userId, reviewId),
        reviewId,
        userId,
        voteType,
        createdAt: new Date().toISOString()
      };
      
      return this.create(vote);
    }
  }

  /**
   * Get vote counts for a review
   */
  async getVoteCounts(reviewId: string): Promise<{ upvotes: number; downvotes: number }> {
    const votes = await this.getVotesForReview(reviewId);
    
    const upvotes = votes.filter(vote => vote.voteType === 'up').length;
    const downvotes = votes.filter(vote => vote.voteType === 'down').length;
    
    return { upvotes, downvotes };
  }

  /**
   * Get vote counts for multiple reviews
   */
  async getVoteCountsForReviews(reviewIds: string[]): Promise<Record<string, { upvotes: number; downvotes: number }>> {
    const voteCounts: Record<string, { upvotes: number; downvotes: number }> = {};
    
    // Initialize all review IDs with zero counts
    reviewIds.forEach(reviewId => {
      voteCounts[reviewId] = { upvotes: 0, downvotes: 0 };
    });

    // Get votes for all reviews in parallel
    const votePromises = reviewIds.map(reviewId => this.getVotesForReview(reviewId));
    const allVotes = await Promise.all(votePromises);
    
    // Count votes for each review
    allVotes.forEach((votes, index) => {
      const reviewId = reviewIds[index];
      if (reviewId && voteCounts[reviewId]) {
        votes.forEach(vote => {
          const counts = voteCounts[reviewId];
          if (counts) {
            if (vote.voteType === 'up') {
              counts.upvotes++;
            } else {
              counts.downvotes++;
            }
          }
        });
      }
    });
    
    return voteCounts;
  }

  /**
   * Remove all votes for a review (when review is deleted)
   */
  async removeVotesForReview(reviewId: string): Promise<void> {
    const votes = await this.getVotesForReview(reviewId);
    
    const deletePromises = votes.map(vote => this.delete(vote.voteId));
    await Promise.all(deletePromises);
  }

  /**
   * Generate a unique vote ID
   */
  private generateVoteId(userId: string, reviewId: string): string {
    return `${userId}#${reviewId}`;
  }

  protected buildKey(voteId: string): any {
    return { voteId };
  }

  protected getCreateCondition(): string {
    return 'attribute_not_exists(voteId)';
  }
}