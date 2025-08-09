import TelegramBot from "node-telegram-bot-api";
import { ReviewService } from "../services/ReviewService";
import { CourseService } from "../services/CourseService";
import { StateManager } from "../services/StateManager";
import { Logger, LogCategory } from "../utils/Logger";
import { ConversationState } from "../models";

/**
 * Dedicated handler for review editing functionality
 */
export class ReviewEditHandler {
  private bot: TelegramBot;
  private reviewService: ReviewService;
  private courseService: CourseService;
  private stateManager: StateManager;
  private logger: Logger;
  private editingReviews: Map<string, any> = new Map(); // Temporary storage for editing reviews

  constructor(
    bot: TelegramBot,
    reviewService: ReviewService,
    courseService: CourseService,
    stateManager: StateManager
  ) {
    this.bot = bot;
    this.reviewService = reviewService;
    this.courseService = courseService;
    this.stateManager = stateManager;
    this.logger = Logger.getInstance();
  }

  /**
   * Handle edit review callback - shows the edit review interface
   */
  async handleEditReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      const reviewId = data.replace('edit_review_', '');

      // Get the review to edit from the database
      const userReviews = await this.reviewService.getUserReviews(userId);
      const review = userReviews.find(r => r.reviewId === reviewId);

      if (!review) {
        await this.bot.editMessageText(
          "❌ Review not found or you don't have permission to edit it.",
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to My Reviews", callback_data: "my_reviews" }],
                [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
              ]
            }
          }
        );
        return;
      }

      // Get course details for display
      const courseDetails = await this.courseService.getCourseDetails(review.courseId);

      // Store the review in editing state
      const editingReview = {
        ...review,
        courseName: courseDetails?.name || review.courseId
      };

      this.editingReviews.set(userId, editingReview);
      await this.stateManager.setState(userId, ConversationState.EDITING_REVIEW, { reviewId });

      const message = this.formatEditReviewMessage(editingReview);
      const keyboard = this.createEditReviewKeyboard(reviewId);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle edit review callback",
        error,
        { userId, reviewId: data },
        userId
      );

      await this.bot.sendMessage(
        chatId,
        "❌ Failed to load review for editing. Please try again."
      );
    }
  }

  /**
   * Handle edit rating callback - shows rating selection interface
   */
  async handleEditRatingCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      
      // Parse: edit_rating_reviewId_ratingType
      const parts = data.split('_');
      
      if (parts.length < 4) {
        throw new Error(`Invalid edit rating callback data: expected at least 4 parts, got ${parts.length}`);
      }

      const ratingType = parts[parts.length - 1] as 'overall' | 'quality' | 'difficulty';
      const reviewId = parts.slice(2, -1).join('_');
      
      let review = this.editingReviews.get(userId);
      
      if (!review) {
        // Try to fetch the review from database as fallback
        const userReviews = await this.reviewService.getUserReviews(userId);
        const foundReview = userReviews.find(r => r.reviewId === reviewId);

        if (!foundReview) {
          await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
          return;
        }

        // Get course details and store in cache
        const courseDetails = await this.courseService.getCourseDetails(foundReview.courseId);
        review = {
          ...foundReview,
          courseName: courseDetails?.name || foundReview.courseId
        };
        this.editingReviews.set(userId, review);
        await this.stateManager.setState(userId, ConversationState.EDITING_REVIEW, { reviewId });
      }

      const message = this.formatRatingEditMessage(review, ratingType);
      const keyboard = this.createRatingSelectionKeyboard(reviewId, ratingType);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      console.error("ReviewEditHandler: Edit rating callback error details", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        data
      });

      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle edit rating callback",
        error,
        { userId, data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to load rating editor. Please try again.");
    }
  }

  /**
   * Handle set rating callback - updates a specific rating value
   */
  async handleSetRatingCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      // Parse: set_rating_reviewId_ratingType_value
      // Note: reviewId can contain underscores, so we need to be careful with parsing
      const parts = data.split('_');
      if (parts.length < 5) {
        throw new Error('Invalid set rating callback data');
      }

      // The value is always the last part, ratingType is second to last
      const ratingValue = parseInt(parts[parts.length - 1]);
      const ratingType = parts[parts.length - 2] as 'overall' | 'quality' | 'difficulty';

      // The reviewId is everything between "set_rating_" and the final "_ratingType_value"
      const reviewId = parts.slice(2, -2).join('_');

      if (ratingValue < 1 || ratingValue > 5) {
        throw new Error('Invalid rating value');
      }

      const review = this.editingReviews.get(userId);
      if (!review) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      // Update the rating
      review.ratings[ratingType] = ratingValue;
      this.editingReviews.set(userId, review);

      // Return to edit review interface
      const message = this.formatEditReviewMessage(review);
      const keyboard = this.createEditReviewKeyboard(reviewId);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle set rating callback",
        error,
        { userId, data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to update rating. Please try again.");
    }
  }

  /**
   * Handle edit text callback - prompts for new review text
   */
  async handleEditTextCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      const reviewId = data.replace('edit_text_', '');

      const review = this.editingReviews.get(userId);
      if (!review) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      const message = `✏️ *Edit Review Text*

*Current text:*
${review.text}

Please send your new review text (max 2000 characters). 

Send "-" to remove the text entirely, or "cancel" to go back.`;

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Cancel", callback_data: `edit_review_${reviewId}` }]
          ]
        }
      });

      // Set state to expect text input
      await this.stateManager.setState(userId, ConversationState.EDITING_REVIEW_TEXT, { reviewId });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle edit text callback",
        error,
        { userId, data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to start text editing. Please try again.");
    }
  }

  /**
   * Handle text input for review editing
   */
  async handleTextInput(
    userId: string,
    chatId: number,
    text: string
  ): Promise<void> {
    try {
      const state = await this.stateManager.getState(userId);

      if (state?.state !== ConversationState.EDITING_REVIEW_TEXT) {
        return; // Not in text editing mode
      }

      const reviewId = state.data?.reviewId;
      if (!reviewId) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      const review = this.editingReviews.get(userId);
      if (!review) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      // Handle special commands
      if (text.toLowerCase() === 'cancel') {
        // Return to edit review interface
        const message = this.formatEditReviewMessage(review);
        const keyboard = this.createEditReviewKeyboard(reviewId);

        await this.bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          reply_markup: keyboard
        });

        await this.stateManager.setState(userId, ConversationState.EDITING_REVIEW, { reviewId });
        return;
      }

      // Handle text removal
      if (text === '-') {
        review.text = undefined;
      } else {
        // Validate text length
        if (text.length > 2000) {
          await this.bot.sendMessage(
            chatId,
            "❌ Review text is too long. Please keep it under 2000 characters."
          );
          return;
        }
        review.text = text;
      }

      // Update the stored review
      this.editingReviews.set(userId, review);

      // Return to edit review interface
      const message = this.formatEditReviewMessage(review);
      const keyboard = this.createEditReviewKeyboard(reviewId);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

      await this.stateManager.setState(userId, ConversationState.EDITING_REVIEW, { reviewId });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle text input for review editing",
        error,
        { userId, textLength: text.length },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to update review text. Please try again.");
    }
  }

  /**
   * Handle edit anonymous callback - toggles anonymity setting
   */
  async handleEditAnonymousCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      const reviewId = data.replace('edit_anonymous_', '');

      const review = this.editingReviews.get(userId);
      if (!review) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      // Toggle anonymity
      review.anonymous = !review.anonymous;
      this.editingReviews.set(userId, review);

      const message = this.formatEditReviewMessage(review);
      const keyboard = this.createEditReviewKeyboard(reviewId);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to handle edit anonymous callback",
        error,
        { userId, data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to toggle anonymity. Please try again.");
    }
  }

  /**
   * Handle save review callback - saves the edited review
   */
  async handleSaveReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      const reviewId = data.replace('save_review_', '');

      const editedReview = this.editingReviews.get(userId);
      if (!editedReview) {
        await this.bot.sendMessage(chatId, "❌ No review being edited. Please start over.");
        return;
      }

      // Save the review using ReviewService
      await this.reviewService.updateReview({
        reviewId,
        userId,
        ratings: editedReview.ratings,
        text: editedReview.text,
        anonymous: editedReview.anonymous
      });

      // Clear editing state
      this.editingReviews.delete(userId);
      await this.stateManager.setState(userId, ConversationState.VIEWING_MY_REVIEWS);

      const successMessage = `✅ *Review Updated Successfully!*

Your review has been saved with the new changes.`;

      await this.bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⭐ My Reviews", callback_data: "my_reviews" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
          ]
        }
      });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to save edited review",
        error,
        { userId, reviewId: data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to save review changes. Please try again.");
    }
  }

  /**
   * Handle cancel edit callback - cancels the edit operation
   */
  async handleCancelEditCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId: number
  ): Promise<void> {
    try {
      // Clear editing state
      this.editingReviews.delete(userId);
      await this.stateManager.setState(userId, ConversationState.VIEWING_MY_REVIEWS);

      const message = `❌ *Edit Cancelled*

Your review changes have been discarded.

*What would you like to do next?*`;

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⭐ My Reviews", callback_data: "my_reviews" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
          ]
        }
      });

    } catch (error) {
      this.logger.error(
        LogCategory.WEBHOOK,
        "Failed to cancel edit",
        error,
        { userId, data },
        userId
      );

      await this.bot.sendMessage(chatId, "❌ Failed to cancel edit. Please try again.");
    }
  }

  // Helper methods

  private formatEditReviewMessage(review: any): string {
    const courseInfo = `🔢 *${review.courseId} - ${review.courseName}*`;

    const ratingsInfo = `⭐ *Current Ratings:*
• Overall: ${'⭐'.repeat(review.ratings.overall)}${'☆'.repeat(5 - review.ratings.overall)} (${review.ratings.overall}/5)
• Quality: ${'⭐'.repeat(review.ratings.quality)}${'☆'.repeat(5 - review.ratings.quality)} (${review.ratings.quality}/5)
• Difficulty: ${'⭐'.repeat(review.ratings.difficulty)}${'☆'.repeat(5 - review.ratings.difficulty)} (${review.ratings.difficulty}/5)`;

    const visibilityInfo = `👤 *Visibility:* ${review.anonymous ? 'Anonymous' : 'Public'}`;

    const textInfo = review.text
      ? `💬 *Review Text:*\n${review.text.substring(0, 200)}${review.text.length > 200 ? '...' : ''}`
      : `💬 *Review Text:* _No text provided_`;

    return `✏️ *Edit Review*

${courseInfo}

${ratingsInfo}

${visibilityInfo}

${textInfo}

*Select what you'd like to edit:*`;
  }

  private createEditReviewKeyboard(reviewId: string): any {
    return {
      inline_keyboard: [
        [
          { text: "⭐ Overall Rating", callback_data: `edit_rating_${reviewId}_overall` },
          { text: "🎯 Quality Rating", callback_data: `edit_rating_${reviewId}_quality` }
        ],
        [
          { text: "📊 Difficulty Rating", callback_data: `edit_rating_${reviewId}_difficulty` }
        ],
        [
          { text: "✏️ Edit Text", callback_data: `edit_text_${reviewId}` },
          { text: "👤 Toggle Anonymous", callback_data: `edit_anonymous_${reviewId}` }
        ],
        [
          { text: "💾 Save Changes", callback_data: `save_review_${reviewId}` }
        ],
        [
          { text: "❌ Cancel", callback_data: `cancel_edit_${reviewId}` },
          { text: "🔙 Back to My Reviews", callback_data: "my_reviews" }
        ]
      ]
    };
  }

  private formatRatingEditMessage(review: any, ratingType: string): string {
    const ratingNames = {
      overall: 'Overall Rating',
      quality: 'Quality Rating',
      difficulty: 'Difficulty Rating'
    };

    const currentRating = review.ratings[ratingType];
    const ratingName = ratingNames[ratingType as keyof typeof ratingNames];

    return `⭐ *Edit ${ratingName}*

*Course:* ${review.courseId} - ${review.courseName}

*Current ${ratingName}:* ${'⭐'.repeat(currentRating)}${'☆'.repeat(5 - currentRating)} (${currentRating}/5)

*Select your new rating:*`;
  }

  private createRatingSelectionKeyboard(reviewId: string, ratingType: string): any {
    return {
      inline_keyboard: [
        [
          { text: "⭐", callback_data: `set_rating_${reviewId}_${ratingType}_1` },
          { text: "⭐⭐", callback_data: `set_rating_${reviewId}_${ratingType}_2` },
          { text: "⭐⭐⭐", callback_data: `set_rating_${reviewId}_${ratingType}_3` }
        ],
        [
          { text: "⭐⭐⭐⭐", callback_data: `set_rating_${reviewId}_${ratingType}_4` },
          { text: "⭐⭐⭐⭐⭐", callback_data: `set_rating_${reviewId}_${ratingType}_5` }
        ],
        [
          { text: "🔙 Back to Edit", callback_data: `edit_review_${reviewId}` },
          { text: "❌ Cancel", callback_data: `cancel_edit_${reviewId}` }
        ]
      ]
    };
  }

}