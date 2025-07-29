import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import TelegramBot from "node-telegram-bot-api";
import { RateLimitService } from "../services/RateLimitService";
import { StateManager } from "../services/StateManager";
import { ReviewService } from "../services/ReviewService";
import { CourseService } from "../services/CourseService";
import { ReviewEditHandler } from "./ReviewEditHandler";
import { UIComponents } from "../utils/UIComponents";
import { UserRepository } from "../database/repositories/user";
import {
  ConversationState,
  TelegramUpdate,
  Message,
  CallbackQuery,
  TelegramUser,
  CourseCategory,
  User,
} from "../models";

/**
 * Command routing interface
 */
export interface CommandRoute {
  command: string;
  handler: (userId: string, chatId: number, args?: string[]) => Promise<void>;
}

/**
 * Callback query routing interface
 */
export interface CallbackRoute {
  pattern: RegExp;
  handler: (
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ) => Promise<void>;
}

/**
 * Rate limit violation log entry
 */
export interface RateLimitViolation {
  userId: string;
  username?: string;
  violationType: "daily_limit" | "total_limit";
  currentCount: number;
  limit: number;
  timestamp: string;
  resetTime?: string;
}

/**
 * Webhook handler for processing Telegram updates with message routing
 */
export class WebhookHandler {
  private bot: TelegramBot;
  private rateLimitService: RateLimitService;
  private stateManager: StateManager;
  private reviewService: ReviewService;
  private courseService: CourseService;
  private reviewEditHandler: ReviewEditHandler;
  private userRepository: UserRepository;
  private commandRoutes: Map<string, CommandRoute>;
  private callbackRoutes: CallbackRoute[];

  constructor(
    botToken: string,
    rateLimitService: RateLimitService,
    stateManager: StateManager,
    reviewService: ReviewService,
    courseService: CourseService,
    bot?: TelegramBot
  ) {
    this.bot = bot || new TelegramBot(botToken);
    this.rateLimitService = rateLimitService;
    this.stateManager = stateManager;
    this.reviewService = reviewService;
    this.courseService = courseService;
    this.userRepository = new UserRepository(
      this.reviewService['reviewRepository']['documentClient']
    );
    this.reviewEditHandler = new ReviewEditHandler(
      this.bot,
      this.reviewService,
      this.courseService,
      this.stateManager
    );
    this.commandRoutes = new Map();
    this.callbackRoutes = [];

    this.initializeRoutes();
  }

  /**
   * Main handler for incoming webhook requests
   */
  async handleWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      // Parse the incoming update
      const update = this.parseUpdate(event);
      if (!update) {
        console.warn("Invalid update received:", event.body);
        return this.createResponse(400, { error: "Invalid update format" });
      }

      // Extract user information
      const user = this.extractUser(update);
      if (!user) {
        console.warn("No user found in update:", update);
        return this.createResponse(200, { message: "No user to process" });
      }

      const userId = user.id.toString();

      // Check rate limits before processing the message
      const rateLimitResult = await this.rateLimitService.checkRateLimit(
        userId
      );

      if (!rateLimitResult.allowed) {
        // Log rate limit violation
        const violation: RateLimitViolation = {
          userId,
          violationType: rateLimitResult.reason?.includes("Daily")
            ? "daily_limit"
            : "total_limit",
          currentCount: rateLimitResult.reason?.includes("Daily")
            ? rateLimitResult.dailyCount
            : rateLimitResult.totalCount,
          limit: rateLimitResult.reason?.includes("Daily")
            ? rateLimitResult.dailyLimit
            : rateLimitResult.totalLimit,
          timestamp: new Date().toISOString(),
        };

        if (user.username !== undefined) {
          violation.username = user.username;
        }

        if (rateLimitResult.resetTime) {
          violation.resetTime = rateLimitResult.resetTime.toISOString();
        }

        await this.logRateLimitViolation(violation);

        // Send rate limit error response to user
        await this.sendRateLimitErrorResponse(user.id, rateLimitResult);

        return this.createResponse(200, { message: "Rate limit exceeded" });
      }

      // Record the message (increment counters)
      await this.rateLimitService.recordMessage(userId);

      // Process the message (placeholder for now - will be implemented in later tasks)
      await this.processUpdate(update, user);

      return this.createResponse(200, {
        message: "Update processed successfully",
      });
    } catch (error) {
      console.error("Error processing webhook:", error);
      return this.createResponse(500, { error: "Internal server error" });
    }
  }

  /**
   * Parse incoming update from API Gateway event
   */
  private parseUpdate(event: APIGatewayProxyEvent): TelegramUpdate | null {
    try {
      if (!event.body) {
        return null;
      }
      return JSON.parse(event.body) as TelegramUpdate;
    } catch (error) {
      console.error("Failed to parse update:", error);
      return null;
    }
  }

  /**
   * Extract user information from update
   */
  private extractUser(update: TelegramUpdate): {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  } | null {
    if (update.message?.from) {
      return update.message.from;
    }
    if (update.callback_query?.from) {
      return update.callback_query.from;
    }
    return null;
  }

  /**
   * Send rate limit error response to user
   */
  private async sendRateLimitErrorResponse(
    chatId: number,
    rateLimitResult: any
  ): Promise<void> {
    try {
      let message = "⚠️ Rate limit exceeded!\n\n";

      if (rateLimitResult.reason?.includes("Daily")) {
        message += `You have reached your daily message limit of ${rateLimitResult.dailyLimit} messages.\n`;
        message += `Your limit will reset at midnight UTC`;
        if (rateLimitResult.resetTime) {
          const resetTime = new Date(rateLimitResult.resetTime);
          message += ` (${resetTime.toUTCString()})`;
        }
        message += ".\n\n";
        message += `Current usage: ${rateLimitResult.dailyCount}/${rateLimitResult.dailyLimit} daily messages`;
      } else {
        message += `You have reached your total message limit of ${rateLimitResult.totalLimit} messages.\n`;
        message += "This is a lifetime limit and cannot be reset.\n\n";
        message += `Total messages sent: ${rateLimitResult.totalCount}/${rateLimitResult.totalLimit}`;
      }

      message += "\n\nIf you believe this is an error, please contact Alexandre Bismuth (@alex_bsmth).";

      await this.bot.sendMessage(chatId, message);
    } catch (error) {
      console.error("Failed to send rate limit error response:", error);
    }
  }

  /**
   * Log rate limit violation for monitoring and analysis
   */
  private async logRateLimitViolation(
    violation: RateLimitViolation
  ): Promise<void> {
    // Log to console (will be captured by CloudWatch in Lambda)
    console.warn("RATE_LIMIT_VIOLATION", JSON.stringify(violation));

    // Additional structured logging for monitoring
    console.log({
      event: "rate_limit_violation",
      userId: violation.userId,
      username: violation.username,
      violationType: violation.violationType,
      currentCount: violation.currentCount,
      limit: violation.limit,
      timestamp: violation.timestamp,
      resetTime: violation.resetTime,
    });
  }

  /**
   * Initialize command and callback routes
   */
  private initializeRoutes(): void {
    // Basic commands
    this.addCommandRoute("/start", this.handleStartCommand.bind(this));
    this.addCommandRoute("/help", this.handleHelpCommand.bind(this));

    // Callback routes
    this.addCallbackRoute(/^help$/, this.handleHelpCallback.bind(this));

    // Callback query routes
    this.addCallbackRoute(
      /^main_menu$/,
      this.handleMainMenuCallback.bind(this)
    );
    this.addCallbackRoute(
      /^browse_categories$/,
      this.handleBrowseCategoriesCallback.bind(this)
    );
    this.addCallbackRoute(
      /^post_review$/,
      this.handlePostReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^category_(.+)$/,
      this.handleCategoryCallback.bind(this)
    );
    this.addCallbackRoute(
      /^course_(.+)$/,
      this.handleCourseCallback.bind(this)
    );
    this.addCallbackRoute(/^back_(.+)$/, this.handleBackCallback.bind(this));

    // Review reading workflow routes
    this.addCallbackRoute(
      /^reviews_(.+)_page_(\d+)$/,
      this.handleReviewsPageCallback.bind(this)
    );
    this.addCallbackRoute(
      /^reviews_(.+)$/,
      this.handleViewReviewsCallback.bind(this)
    );
    this.addCallbackRoute(
      /^vote_(.+)_(up|down)$/,
      this.handleVoteCallback.bind(this)
    );
    this.addCallbackRoute(
      /^course_details_(.+)$/,
      this.handleCourseDetailsCallback.bind(this)
    );
    this.addCallbackRoute(
      /^courses_(.+)_page_(\d+)$/,
      this.handleCoursesPageCallback.bind(this)
    );

    // Review posting workflow routes
    this.addCallbackRoute(
      /^categories_page_(\d+)$/,
      this.handleCategoriesPageCallback.bind(this)
    );
    this.addCallbackRoute(
      /^review_category_(.+)$/,
      this.handleReviewCategoryCallback.bind(this)
    );
    this.addCallbackRoute(
      /^review_course_(.+)$/,
      this.handleReviewCourseCallback.bind(this)
    );
    this.addCallbackRoute(
      /^rating_(.+)_(\d+)$/,
      this.handleRatingCallback.bind(this)
    );
    this.addCallbackRoute(
      /^review_anonymous_(yes|no)$/,
      this.handleAnonymityCallback.bind(this)
    );
    this.addCallbackRoute(
      /^confirm_review$/,
      this.handleConfirmReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^cancel_review$/,
      this.handleCancelReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_review_(.+)$/,
      this.handleEditReviewCallback.bind(this)
    );
    // Review editing routes
    this.addCallbackRoute(
      /^edit_rating_(.+)_(overall|quality|difficulty)$/,
      this.handleEditRatingCallback.bind(this)
    );
    this.addCallbackRoute(
      /^set_rating_(.+)_(overall|quality|difficulty)_([1-5])$/,
      this.handleSetRatingCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_text_(.+)$/,
      this.handleEditTextCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_anonymous_(.+)$/,
      this.handleEditAnonymousCallback.bind(this)
    );
    this.addCallbackRoute(
      /^save_review_(.+)$/,
      this.handleSaveReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^cancel_edit_(.+)$/,
      this.handleCancelEditCallback.bind(this)
    );
    this.addCallbackRoute(
      /^skip_text_review$/,
      this.handleSkipTextReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^add_text_review$/,
      this.handleAddTextReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_current_review$/,
      this.handleEditCurrentReviewCallback.bind(this)
    );

    // Additional missing routes
    this.addCallbackRoute(
      /^my_reviews$/,
      this.handleMyReviewsCallback.bind(this)
    );
    this.addCallbackRoute(
      /^my_reviews_page_(\d+)$/,
      this.handleMyReviewsCallback.bind(this)
    );
    this.addCallbackRoute(
      /^manage_review_(.+)$/,
      this.handleManageReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^delete_review_(.+)$/,
      this.handleDeleteReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^confirm_delete_(.+)$/,
      this.handleConfirmDeleteReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^write_review_(.+)$/,
      this.handleWriteReviewCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_anonymity$/,
      this.handleEditAnonymityCallback.bind(this)
    );
    this.addCallbackRoute(
      /^edit_review_text$/,
      this.handleEditReviewTextCallback.bind(this)
    );
    this.addCallbackRoute(
      /^remove_review_text$/,
      this.handleRemoveReviewTextCallback.bind(this)
    );
  }

  /**
   * Add a command route
   */
  private addCommandRoute(
    command: string,
    handler: CommandRoute["handler"]
  ): void {
    this.commandRoutes.set(command, {
      command,
      handler,
    });
  }

  /**
   * Add a callback query route
   */
  private addCallbackRoute(
    pattern: RegExp,
    handler: CallbackRoute["handler"]
  ): void {
    this.callbackRoutes.push({
      pattern,
      handler,
    });
  }

  /**
   * Process the update with proper routing
   */
  private async processUpdate(
    update: TelegramUpdate,
    user: TelegramUser
  ): Promise<void> {
    const userId = user.id.toString();

    try {
      // Renew session activity
      await this.stateManager.renewSession(userId);

      if (update.message) {
        await this.handleMessage(update.message, user);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query, user);
      }
    } catch (error) {
      console.error("Error processing update:", error);
      await this.sendErrorMessage(
        user.id,
        "An error occurred while processing your request. Please try again."
      );
    }
  }

  /**
   * Handle incoming text messages
   */
  private async handleMessage(
    message: Message,
    user: TelegramUser
  ): Promise<void> {
    const userId = user.id.toString();
    const chatId = message.chat.id;
    const text = message.text?.trim();

    if (!text) {
      return;
    }

    // Check if it's a command
    if (text.startsWith("/")) {
      await this.routeCommand(text, userId, chatId);
    } else {
      // Handle text input based on current state
      await this.handleTextInput(text, userId, chatId);
    }
  }

  /**
   * Route command to appropriate handler
   */
  private async routeCommand(
    text: string,
    userId: string,
    chatId: number
  ): Promise<void> {
    const parts = text.split(" ");
    const command = parts[0];
    const args = parts.slice(1);

    if (!command) {
      await this.sendUnknownCommandMessage(chatId);
      return;
    }

    const route = this.commandRoutes.get(command);
    if (!route) {
      await this.sendUnknownCommandMessage(chatId);
      return;
    }

    await route.handler(userId, chatId, args);
  }

  /**
   * Handle callback queries from inline keyboards
   */
  private async handleCallbackQuery(
    callbackQuery: CallbackQuery,
    user: TelegramUser
  ): Promise<void> {
    const userId = user.id.toString();
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message?.message_id;

    if (!chatId || !data) {
      return;
    }

    // Answer the callback query to remove loading state
    try {
      await this.bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error("Failed to answer callback query:", error);
    }

    // Find matching route
    for (const route of this.callbackRoutes) {
      const match = data.match(route.pattern);
      if (match) {
        await route.handler(userId, chatId, data, messageId);
        return;
      }
    }

    // No matching route found
    await this.sendUnknownCallbackMessage(chatId);
  }

  /**
   * Handle text input based on current conversation state
   */
  private async handleTextInput(
    text: string,
    userId: string,
    chatId: number
  ): Promise<void> {
    const stateData = await this.stateManager.getState(userId);
    const currentState = stateData?.state || ConversationState.MAIN_MENU;

    switch (currentState) {
      case ConversationState.MAIN_MENU:
        // User is at main menu - send main menu options
        await this.handleMainMenuCallback(userId, chatId, "main_menu");
        break;

      case ConversationState.POSTING_REVIEW:
        // Handle review text input
        if (stateData?.data?.waitingForReviewText) {
          await this.handleReviewTextInput(text, userId, chatId);
        }
        break;

      case ConversationState.COLLECTING_NAME:
        await this.handleNameInput(text, userId, chatId);
        break;

      case ConversationState.COLLECTING_PROMOTION:
        await this.handlePromotionInput(text, userId, chatId);
        break;

      case ConversationState.EDITING_REVIEW_TEXT:
        // Handle review editing text input
        await this.reviewEditHandler.handleTextInput(userId, chatId, text);
        break;

      default:
        await this.sendUnknownInputMessage(chatId);
        break;
    }
  }

  // User information collection handlers
  private async handleNameInput(
    text: string,
    userId: string,
    chatId: number
  ): Promise<void> {
    const name = text.trim();

    if (!name || name.length < 2 || name.length > 40) {
      await this.bot.sendMessage(
        chatId,
        "❌ Please enter a valid name (2-40 characters):"
      );
      return;
    }

    const stateData = await this.stateManager.getState(userId);
    if (!stateData?.data) return;

    await this.stateManager.setState(
      userId,
      ConversationState.COLLECTING_PROMOTION,
      {
        ...stateData.data,
        userProfile: {
          ...stateData.data.userProfile,
          name
        }
      }
    );

    await this.bot.sendMessage(
      chatId,
      `✅ Name: **${name}**\n\nNow please enter your **promotion** (e.g., BX25, BX26 etc.):`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Cancel", callback_data: "cancel_review" }]
          ]
        }
      }
    );
  }

  private async handlePromotionInput(
    text: string,
    userId: string,
    chatId: number
  ): Promise<void> {
    const promotion = text.trim().toUpperCase();

    if (!promotion || promotion.length !== 4) {
      await this.bot.sendMessage(
        chatId,
        "❌ Please enter a valid promotion (4 characters, e.g., BX25):"
      );
      return;
    }

    const stateData = await this.stateManager.getState(userId);
    if (!stateData?.data) return;

    const userProfile = {
      ...stateData.data.userProfile,
      promotion
    };

    // Save user profile to database
    await this.userRepository.updateProfile(userId, userProfile);

    // Update state and proceed to confirmation
    await this.stateManager.setState(
      userId,
      ConversationState.POSTING_REVIEW,
      {
        ...stateData.data,
        step: "confirmation",
        anonymous: false,
        userProfile
      }
    );

    await this.bot.sendMessage(
      chatId,
      `✅ Profile completed! (It will also be remembered for future reviews). \n\n**Name:** ${userProfile.name}\n**Promotion:** ${promotion}\n\nThis information will be displayed with your public reviews.`,
      {
        parse_mode: "Markdown"
      }
    );

    // Show review confirmation
    await this.showReviewConfirmation(userId, chatId);
  }

  // Command handlers (placeholder implementations)
  private async handleStartCommand(
    userId: string,
    chatId: number
  ): Promise<void> {
    await this.stateManager.setState(userId, ConversationState.MAIN_MENU);
    await this.bot.sendMessage(
      chatId,
      "🎉 Welcome to PickYourCourses!\n\n" +
      "📚 Your gateway to École Polytechnique course reviews.\n\n" +
      "📖 This bot helps students:\n" +
      "• 📚 Browse course reviews by category\n" +
      "• ✍️ Share their own course experiences\n" +
      "• ⭐ Rate courses on quality and difficulty\n" +
      "• 🗳️ Vote on helpful reviews\n\n" +
      "What would you like to do today?",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ],
        },
      }
    );
  }

  private async handleHelpCommand(
    _userId: string,
    chatId: number
  ): Promise<void> {
    const helpText =
      "🤖 PickYourCourses Bot Help\n\n" +
      "📚 Available commands:\n" +
      "• /start - Start the bot and go to the main menu\n" +
      "• /help - Show this help message\n\n" +
      "🎓 About this bot:\n" +
      "PickYourCourses helps École Polytechnique students share and read course reviews. " +
      "You can browse reviews by category, post your own experiences, and vote on helpful reviews.\n\n" +
      "❓ For support, contact Alexandre Bismuth (@alex_bsmth).";

    await this.bot.sendMessage(chatId, helpText);
  }

  // Callback handlers
  private async handleMainMenuCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      await this.stateManager.setState(userId, ConversationState.MAIN_MENU);

      const message =
        "🏠 **Main Menu**\n\n" +
        "Welcome to PickYourCourses! What would you like to do?\n\n" +
        "📚 **Browse Courses** - Explore course reviews by category\n" +
        "✍️ **Post Review** - Share your course experience\n" +
        "⭐ **My Reviews** - View and manage your reviews";

      const keyboard = UIComponents.createMainMenu();

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Main menu callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load main menu. Please try again."
      );
    }
  }

  private async handleBrowseCategoriesCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      await this.stateManager.setState(
        userId,
        ConversationState.BROWSING_CATEGORIES
      );

      const message =
        "📚 **Browse Course Reviews**\n\n" +
        "Select a category to explore courses and read reviews from other students.\n\n" +
        "Choose from the categories below:";

      const keyboard = UIComponents.createCategoriesMenuPage1();

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Browse categories callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load categories. Please try again."
      );
    }
  }

  private async handlePostReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        { step: "category_selection" }
      );

      const message =
        "✍️ **Post a Course Review**\n\n" +
        "📚 Let's help other students by sharing your course experience!\n\n" +
        "**Step 1 of 5:** Choose a course category\n\n" +
        "Select the category that contains the course you want to review:";

      const keyboard = UIComponents.createCategoriesMenuPage1();

      // Update keyboard to use review_category_ prefix instead of category_
      if (keyboard.inline_keyboard) {
        keyboard.inline_keyboard = keyboard.inline_keyboard.map((row: any[]) =>
          row.map((button: any) => {
            if (
              button.callback_data &&
              button.callback_data.startsWith("category_")
            ) {
              return {
                ...button,
                callback_data: button.callback_data.replace(
                  "category_",
                  "review_category_"
                ),
              };
            }
            return button;
          })
        );
      }

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Post review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to start review posting. Please try again."
      );
    }
  }

  private async handleCategoryCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^category_(.+)$/);
      const category = match?.[1] as CourseCategory;

      if (!category || !this.courseService.isValidCategory(category)) {
        await this.sendErrorMessage(chatId, "Invalid category selected.");
        return;
      }

      await this.stateManager.setState(
        userId,
        ConversationState.BROWSING_CATEGORIES,
        { selectedCategory: category }
      );

      // Get courses in the selected category
      const courses = await this.courseService.getCoursesByCategory(category);

      if (courses.length === 0) {
        const message =
          `📚 **${UIComponents.getCategoryEmoji(
            category
          )} ${category} Courses**\n\n` +
          "No courses found in this category yet.\n\n" +
          "Please select a different category:";

        const keyboard = UIComponents.createCategoriesMenuPage1();

        if (messageId) {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        } else {
          await this.bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        }
        return;
      }

      // Display courses with pagination
      const { keyboard } = UIComponents.createCourseList(
        courses.map((course) => ({
          courseId: course.courseId,
          name: course.name,
          ...(course.averageRatings.overall > 0 && {
            averageRating: course.averageRatings.overall,
          }),
        })),
        category,
        1
      );

      const categoryEmoji = UIComponents.getCategoryEmoji(category);
      const message =
        `📚 **${categoryEmoji} ${category} Courses**\n\n` +
        `Found ${courses.length} course${courses.length !== 1 ? "s" : ""} in this category.\n\n` +
        "Select a course to view details and reviews:";

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Category callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load courses. Please try again."
      );
    }
  }

  private async handleCourseCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^course_(.+)$/);
      const courseId = match?.[1];

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      // Get course details first to access category information
      const courseDetails = await this.courseService.getCourseDetails(courseId);
      if (!courseDetails) {
        await this.sendErrorMessage(chatId, "Course not found.");
        return;
      }

      await this.stateManager.setState(
        userId,
        ConversationState.VIEWING_COURSE,
        {
          courseId,
          category: courseDetails.category,
        }
      );

      // Format course information
      const categoryEmoji = UIComponents.getCategoryEmoji(
        courseDetails.category
      );
      let message = `📚 **${categoryEmoji} ${courseDetails.courseId} - ${courseDetails.name}**\n\n`;

      // Add average ratings
      if (courseDetails.reviewCount > 0) {
        message += "⭐ **Average Ratings:**\n";
        message += `• Overall: ${UIComponents.formatStarRating(
          courseDetails.averageRatings.overall
        )}\n`;
        message += `• Quality: ${UIComponents.formatStarRating(
          courseDetails.averageRatings.quality
        )}\n`;
        message += `• Difficulty: ${UIComponents.formatStarRating(
          courseDetails.averageRatings.difficulty
        )}\n\n`;
        message += `📊 Based on ${courseDetails.reviewCount} review${courseDetails.reviewCount !== 1 ? "s" : ""}\n\n`;
      } else {
        message += "📊 **No reviews yet**\n\n";
        message +=
          "Be the first to share your experience with this course!\n\n";
      }

      // Add grading scheme if available
      if (
        courseDetails.gradingScheme &&
        courseDetails.gradingScheme.components.length > 0
      ) {
        message += "💯 **Grading Scheme:**\n";
        courseDetails.gradingScheme.components.forEach((component) => {
          message += `• ${component.name}: ${component.percentage}%\n`;
        });
        message += "\n";
      }

      const keyboard = UIComponents.createCourseDetailsMenu(courseId);

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Course callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load course details. Please try again."
      );
    }
  }

  private async handleBackCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^back_(.+)$/);
      const target = match?.[1];

      if (!target) {
        await this.sendErrorMessage(chatId, "Invalid back navigation target.");
        return;
      }

      // Handle different back navigation targets
      switch (target) {
        case "main_menu":
          await this.handleMainMenuCallback(
            userId,
            chatId,
            "main_menu",
            messageId
          );
          break;
        case "categories":
          await this.handleBrowseCategoriesCallback(
            userId,
            chatId,
            "browse_categories",
            messageId
          );
          break;
        case "to_category": {
          // Navigate back to the category that contains the current course
          const stateData = await this.stateManager.getState(userId);
          if (stateData?.data?.category) {
            await this.handleCategoryCallback(
              userId,
              chatId,
              `category_${stateData.data.category}`,
              messageId
            );
          } else {
            // Fallback to browse categories if no category info available
            await this.handleBrowseCategoriesCallback(
              userId,
              chatId,
              "browse_categories",
              messageId
            );
          }
          break;
        }
        case "course": {
          // Get the current state to find the course ID
          const stateData = await this.stateManager.getState(userId);
          if (stateData?.data?.courseId) {
            await this.handleCourseCallback(
              userId,
              chatId,
              `course_${stateData.data.courseId}`,
              messageId
            );
          } else {
            await this.handleBrowseCategoriesCallback(
              userId,
              chatId,
              "browse_categories",
              messageId
            );
          }
          break;
        }
        default:
          // For other cases, try to parse the target as a specific callback
          if (target.startsWith("category_")) {
            await this.handleCategoryCallback(
              userId,
              chatId,
              target,
              messageId
            );
          } else if (target.startsWith("course_")) {
            await this.handleCourseCallback(userId, chatId, target, messageId);
          } else {
            // Fallback to main menu
            await this.handleMainMenuCallback(
              userId,
              chatId,
              "main_menu",
              messageId
            );
          }
          break;
      }
    } catch (error) {
      console.error("Back callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to navigate back. Please try again."
      );
    }
  }

  // Review posting workflow handlers
  private async handleCategoriesPageCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^categories_page_(\d+)$/);
      const pageNumber = parseInt(match?.[1] || "1");

      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW &&
        stateData?.state !== ConversationState.BROWSING_CATEGORIES
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for category selection."
        );
        return;
      }

      let message: string;
      let keyboard: any;

      const isPostingReview =
        stateData?.state === ConversationState.POSTING_REVIEW;

      if (pageNumber === 1) {
        if (isPostingReview) {
          message =
            "✍️ **Post a Course Review**\n\n" +
            "📚 Let's help other students by sharing your course experience!\n\n" +
            "**Step 1 of 5:** Choose a course category\n\n" +
            "Select the category that contains the course you want to review:";
        } else {
          message =
            "📚 **Browse Course Reviews**\n\n" +
            "Select a category to explore courses and read reviews from other students.\n\n" +
            "Choose from the categories below:";
        }
        keyboard = UIComponents.createCategoriesMenuPage1();
      } else {
        if (isPostingReview) {
          message =
            "✍️ **Post a Course Review**\n\n" +
            "📚 Let's help other students by sharing your course experience!\n\n" +
            "**Step 1 of 5:** Choose a course category (Page 2)\n\n" +
            "Select the category that contains the course you want to review:";
        } else {
          message =
            "📚 **Browse Course Reviews**\n\n" +
            "Select a category to explore courses and read reviews from other students.\n\n" +
            "Choose from the categories below (Page 2):";
        }
        keyboard = UIComponents.createCategoriesMenuPage2();
      }

      // Update keyboard to use review_category_ prefix instead of category_ only for posting reviews
      if (isPostingReview && keyboard.inline_keyboard) {
        keyboard.inline_keyboard = keyboard.inline_keyboard.map((row: any[]) =>
          row.map((button: any) => {
            if (
              button.callback_data &&
              button.callback_data.startsWith("category_")
            ) {
              return {
                ...button,
                callback_data: button.callback_data.replace(
                  "category_",
                  "review_category_"
                ),
              };
            }
            return button;
          })
        );
      }

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Categories page callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load categories. Please try again."
      );
    }
  }

  private async handleReviewCategoryCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^review_category_(.+)$/);
      const category = match?.[1] as CourseCategory;

      if (!category || !this.courseService.isValidCategory(category)) {
        await this.sendErrorMessage(chatId, "Invalid category selected.");
        return;
      }

      const stateData = await this.stateManager.getState(userId);
      if (stateData?.state !== ConversationState.POSTING_REVIEW) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for course selection."
        );
        return;
      }

      // Get courses in the selected category
      const courses = await this.courseService.getCoursesByCategory(category);

      if (courses.length === 0) {
        const message =
          `📚 **No courses found in ${category}**\n\n` +
          "This category doesn't have any courses yet.\n\n" +
          "Please select a different category:";

        const keyboard = UIComponents.createCategoriesMenuPage1();
        // Update keyboard to use review_category_ prefix
        if (keyboard.inline_keyboard) {
          keyboard.inline_keyboard = keyboard.inline_keyboard.map(
            (row: any[]) =>
              row.map((button: any) => {
                if (
                  button.callback_data &&
                  button.callback_data.startsWith("category_")
                ) {
                  return {
                    ...button,
                    callback_data: button.callback_data.replace(
                      "category_",
                      "review_category_"
                    ),
                  };
                }
                return button;
              })
          );
        }

        if (messageId) {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        }
        return;
      }

      // Update state with selected category
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          step: "course_selection",
          category,
        }
      );

      const categoryEmoji = UIComponents.getCategoryEmoji(category);
      const message =
        `✍️ **Post a Course Review**\n\n` +
        `**Step 2 of 5:** Choose a course from ${categoryEmoji} ${category}\n\n` +
        `Select the course you want to review:`;

      // Create course selection keyboard
      const courseButtons = courses.map((course) => [
        {
          text: `${course.courseId} - ${course.name}`,
          callback_data: `review_course_${course.courseId}`,
        },
      ]);

      // Add navigation buttons
      courseButtons.push([
        { text: "🔙 Back to Categories", callback_data: "post_review" },
        { text: "❌ Cancel", callback_data: "cancel_review" },
      ]);

      const keyboard = { inline_keyboard: courseButtons };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Review category callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load courses. Please try again."
      );
    }
  }

  private async handleReviewCourseCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^review_course_(.+)$/);
      const courseId = match?.[1];

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      const stateData = await this.stateManager.getState(userId);
      if (stateData?.state !== ConversationState.POSTING_REVIEW) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for rating selection."
        );
        return;
      }

      // Check if user can review this course
      const canReview = await this.reviewService.canUserReviewCourse(
        userId,
        courseId
      );

      if (!canReview.canReview) {
        let message = "❌ **Cannot Review Course**\n\n";

        if (canReview.reason === "User already has a review for this course") {
          message +=
            "You have already reviewed this course.\n\n" +
            "Would you like to update your existing review instead?";

          const keyboard = {
            inline_keyboard: [
              [
                {
                  text: "✏️ Update Review",
                  callback_data: `edit_review_${canReview.existingReview?.reviewId}`,
                },
                {
                  text: "🔙 Choose Different Course",
                  callback_data: "post_review",
                },
              ],
              [{ text: "❌ Cancel", callback_data: "cancel_review" }],
            ],
          };

          if (messageId) {
            await this.bot.editMessageText(message, {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: keyboard,
              parse_mode: "Markdown",
            });
          }
        } else {
          message += `${canReview.reason}\n\nPlease select a different course.`;

          const keyboard = {
            inline_keyboard: [
              [
                {
                  text: "🔙 Choose Different Course",
                  callback_data: "post_review",
                },
                { text: "❌ Cancel", callback_data: "cancel_review" },
              ],
            ],
          };

          if (messageId) {
            await this.bot.editMessageText(message, {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: keyboard,
              parse_mode: "Markdown",
            });
          }
        }
        return;
      }

      // Get course details
      const course = await this.courseService.getCourseDetails(courseId);
      if (!course) {
        await this.sendErrorMessage(chatId, "Course not found.");
        return;
      }

      // Update state with selected course
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          step: "rating_overall",
          category: stateData.data?.category,
          courseId,
          courseName: course.name,
          ratings: {},
        }
      );

      const message =
        `✍️ **Post a Course Review**\n\n` +
        `**Step 3 of 5:** Rate **${course.courseId} - ${course.name}**\n\n` +
        `**Overall Rating:** How would you rate this course overall?\n\n` +
        `Select your rating (1-5 stars):`;

      const keyboard = UIComponents.createRatingKeyboard("overall");

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Review course callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to start rating. Please try again."
      );
    }
  }

  private async handleRatingCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^rating_(.+)_(\d+)$/);
      const ratingType = match?.[1] as "overall" | "quality" | "difficulty";
      const rating = parseInt(match?.[2] || "0");

      if (!ratingType || rating < 1 || rating > 5) {
        await this.sendErrorMessage(chatId, "Invalid rating selected.");
        return;
      }

      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(chatId, "Invalid state for rating.");
        return;
      }

      // Update ratings in state
      const updatedRatings = {
        ...stateData.data.ratings,
        [ratingType]: rating,
      };

      let nextStep: string;
      let message: string;
      let keyboard: any;

      if (ratingType === "overall") {
        nextStep = "rating_quality";
        message =
          `✍️ **Post a Course Review**\n\n` +
          `**Step 3 of 5:** Rate **${stateData.data.courseName}**\n\n` +
          `Overall: ${"⭐".repeat(rating)}\n\n` +
          `**Quality Rating:** How would you rate the course content and teaching quality?\n\n` +
          `Select your rating (1-5 stars):`;
        keyboard = UIComponents.createRatingKeyboard("quality");
      } else if (ratingType === "quality") {
        nextStep = "rating_difficulty";
        message =
          `✍️ **Post a Course Review**\n\n` +
          `**Step 3 of 5:** Rate **${stateData.data.courseName}**\n\n` +
          `Overall: ${"⭐".repeat(updatedRatings.overall)}\n` +
          `Quality: ${"⭐".repeat(rating)}\n\n` +
          `**Difficulty Rating:** How difficult was this course?\n\n` +
          `Select your rating (1-5 stars):`;
        keyboard = UIComponents.createRatingKeyboard("difficulty");
      } else {
        // difficulty
        nextStep = "text_input";
        message =
          `✍️ **Post a Course Review**\n\n` +
          `**Step 4 of 5:** Add detailed review (optional)\n\n` +
          `**${stateData.data.courseName}**\n` +
          `Overall: ${"⭐".repeat(updatedRatings.overall)}\n` +
          `Quality: ${"⭐".repeat(updatedRatings.quality)}\n` +
          `Difficulty: ${"⭐".repeat(rating)}\n\n` +
          `Would you like to add a detailed written review to help other students?\n\n`;

        keyboard = {
          inline_keyboard: [
            [
              {
                text: "✍️ Add Written Review",
                callback_data: "add_text_review",
              },
              { text: "⏭️ Skip", callback_data: "skip_text_review" },
            ],
            [
              { text: "🔙 Back", callback_data: "back_to_rating" },
              { text: "❌ Cancel", callback_data: "cancel_review" },
            ],
          ],
        };
      }

      // Update state
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: nextStep,
          ratings: updatedRatings,
        }
      );

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Rating callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to save rating. Please try again."
      );
    }
  }

  private async handleSkipTextReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for anonymity selection."
        );
        return;
      }

      // Update state to anonymity selection
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: "anonymity_selection",
        }
      );

      const message =
        `✍️ **Post a Course Review**\n\n` +
        `**Step 5 of 5:** Choose anonymity setting\n\n` +
        `**${stateData.data.courseName}**\n` +
        `Overall: ${"⭐".repeat(stateData.data.ratings.overall)}\n` +
        `Quality: ${"⭐".repeat(stateData.data.ratings.quality)}\n` +
        `Difficulty: ${"⭐".repeat(stateData.data.ratings.difficulty)}\n\n` +
        `Would you like to post this review anonymously?\n\n` +
        `• **Anonymous:** Other students won't see your name\n` +
        `• **Public:** Your review will show as "Full Name (Promotion)"`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "🕶️ Post Anonymously",
              callback_data: "review_anonymous_yes",
            },
            { text: "👤 Post Publicly", callback_data: "review_anonymous_no" },
          ],
          [
            { text: "🔙 Back", callback_data: "back_to_text" },
            { text: "❌ Cancel", callback_data: "cancel_review" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Skip text review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to proceed. Please try again."
      );
    }
  }

  private async handleAnonymityCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^review_anonymous_(yes|no)$/);
      const anonymous = match?.[1] === "yes";

      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for review confirmation."
        );
        return;
      }

      if (anonymous) {
        // For anonymous reviews, proceed directly to confirmation
        await this.stateManager.setState(
          userId,
          ConversationState.POSTING_REVIEW,
          {
            ...stateData.data,
            step: "confirmation",
            anonymous: true,
          }
        );

        await this.showReviewConfirmation(userId, chatId, messageId);
      } else {
        // For public reviews, check if user has profile information
        const user = await this.userRepository.get(userId) as User & {
          firstName?: string;
          lastName?: string;
          promotion?: string;
        };

        if (user?.name && user?.promotion) {
          // User already has profile information, proceed to confirmation
          await this.stateManager.setState(
            userId,
            ConversationState.POSTING_REVIEW,
            {
              ...stateData.data,
              step: "confirmation",
              anonymous: false,
              userProfile: {
                name: user.name,
                promotion: user.promotion
              }
            }
          );

          await this.showReviewConfirmation(userId, chatId, messageId);
        } else {
          // Need to collect user information
          await this.stateManager.setState(
            userId,
            ConversationState.COLLECTING_NAME,
            {
              ...stateData.data,
              anonymous: false,
              userProfile: {}
            }
          );

          const message =
            `👤 **Public Review - Profile Information**\n\n` +
            `Since you've chosen to post publicly, we need some information to display with your review.\n\n` +
            `Please enter your **first and last name**:`;

          const keyboard = {
            inline_keyboard: [
              [{ text: "❌ Cancel", callback_data: "cancel_review" }]
            ]
          };

          if (messageId) {
            await this.bot.editMessageText(message, {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: keyboard,
              parse_mode: "Markdown",
            });
          } else {
            await this.bot.sendMessage(chatId, message, {
              reply_markup: keyboard,
              parse_mode: "Markdown",
            });
          }
        }
      }
    } catch (error) {
      console.error("Anonymity callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to set anonymity. Please try again."
      );
    }
  }

  private async showReviewConfirmation(
    userId: string,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    const stateData = await this.stateManager.getState(userId);
    if (!stateData?.data) return;

    const anonymityText = stateData.data.anonymous ? "🕶️ Anonymous" :
      stateData.data.userProfile ?
        `👤 ${stateData.data.userProfile.name} (${stateData.data.userProfile.promotion})` :
        "👤 Public";

    const textReview = stateData.data.text
      ? `\n\n**Review Text:**\n${stateData.data.text}`
      : "";

    const message =
      `✍️ **Review Confirmation**\n\n` +
      `Please confirm your review details:\n\n` +
      `**Course:** ${stateData.data.courseName}\n` +
      `**Overall:** ${"⭐".repeat(stateData.data.ratings.overall)}\n` +
      `**Quality:** ${"⭐".repeat(stateData.data.ratings.quality)}\n` +
      `**Difficulty:** ${"⭐".repeat(stateData.data.ratings.difficulty)}\n` +
      `**Visibility:** ${anonymityText}${textReview}\n\n` +
      `Is this information correct?`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "✅ Submit Review", callback_data: "confirm_review" }],
        [
          { text: "✏️ Edit Review", callback_data: "edit_current_review" },
          { text: "❌ Cancel", callback_data: "cancel_review" },
        ],
      ],
    };

    if (messageId) {
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    } else {
      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    }
  }

  private async handleConfirmReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    let loadingMessageId = messageId;

    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for review submission."
        );
        return;
      }

      // Show loading message and get its ID
      if (messageId) {
        await this.bot.editMessageText("📝 Submitting your review...", {
          chat_id: chatId,
          message_id: messageId,
        });
      } else {
        const sentMessage = await this.bot.sendMessage(
          chatId,
          "📝 Submitting your review..."
        );
        loadingMessageId = sentMessage.message_id;
      }

      // --- Main Review Submission Logic ---
      try {
        // Validate services
        if (!this.reviewService || !this.courseService || !this.stateManager) {
          throw new Error("A required service is not available.");
        }

        // Validate review data from state
        const { courseId, ratings, text, anonymous, courseName } =
          stateData.data;
        if (!courseId || !ratings) {
          throw new Error("Incomplete review data in state.");
        }
        const { overall, quality, difficulty } = ratings;
        if (!overall || !quality || !difficulty) {
          throw new Error("Incomplete ratings in state.");
        }

        // Submit the review
        await this.reviewService.createReview({
          userId,
          courseId,
          ratings: {
            overall: Number(overall),
            quality: Number(quality),
            difficulty: Number(difficulty),
          },
          text: text || undefined,
          anonymous: Boolean(anonymous),
        });

        // --- Post-Submission Logic (State and Success Message) ---
        try {
          // Clear the posting state
          await this.stateManager.setState(
            userId,
            ConversationState.MAIN_MENU
          );

          const successMessage =
            `✅ Review Posted Successfully!\n\n` +
            `Thank you for sharing your experience with ${courseName}!\n\n` +
            `Your review will help other École Polytechnique students make informed course decisions.\n\n` +
            `Visibility: ${anonymous ? "🕶️ Anonymous" : "👤 Public"
            }`;

          const keyboard = {
            inline_keyboard: [
              [
                {
                  text: "📚 Browse Reviews",
                  callback_data: "browse_categories",
                },
                {
                  text: "✍️ Write Another Review",
                  callback_data: "post_review",
                },
              ],
              [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
            ],
          };

          if (loadingMessageId) {
            await this.bot.editMessageText(successMessage, {
              chat_id: chatId,
              message_id: loadingMessageId,
              reply_markup: keyboard,
            });
          } else {
            await this.bot.sendMessage(chatId, successMessage, {
              reply_markup: keyboard,
            });
          }
        } catch (postSubmitError: any) {
          // This catch block handles errors after successful submission
          // (e.g., state clearing or sending the success message fails)
          console.error(
            "Post-submission logic failed for user:",
            userId,
            postSubmitError
          );
          // The user might not get a confirmation, but the review is saved.
          // We can send a simple, non-editable message to inform them.
          await this.bot.sendMessage(
            chatId,
            `✅ Your review for **${courseName}** was saved, but we couldn't update the confirmation message.`,
            { parse_mode: "Markdown" }
          );
        }
      } catch (reviewError: any) {
        // This catch block handles errors during the review submission itself
        console.error("Review submission failed for user:", userId, {
          name: reviewError.name,
          message: reviewError.message,
          stack: reviewError.stack,
        });

        let errorMessage = "❌ **Failed to Submit Review**\n\n";
        if (reviewError.message?.includes("already reviewed")) {
          errorMessage +=
            "You have already reviewed this course. You can edit your existing review from the 'My Reviews' section.";
        } else {
          errorMessage +=
            "An unexpected error occurred while submitting your review.";
        }
        errorMessage +=
          "\n\nPlease try again or contact Alexandre Bismuth (@alex_bsmth) if the problem persists.";

        const keyboard = {
          inline_keyboard: [
            [
              { text: "🔄 Try Again", callback_data: "confirm_review" },
              {
                text: "✏️ Edit Review",
                callback_data: "edit_current_review",
              },
            ],
            [{ text: "❌ Cancel", callback_data: "cancel_review" }],
          ],
        };

        // Send error message without Markdown to prevent parsing issues
        if (loadingMessageId) {
          await this.bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: loadingMessageId,
            reply_markup: keyboard,
          });
        } else {
          await this.bot.sendMessage(chatId, errorMessage, {
            reply_markup: keyboard,
          });
        }
      }
    } catch (error) {
      console.error("Outer confirm review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "A critical error occurred. Please try again."
      );
    }
  }

  private async handleCancelReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      // Clear the posting state
      await this.stateManager.setState(userId, ConversationState.MAIN_MENU);

      const message =
        "❌ **Review Cancelled**\n\n" +
        "Your review has been cancelled and no data was saved.\n\n" +
        "You can start a new review anytime!";

      const keyboard = {
        inline_keyboard: [
          [
            { text: "✍️ Write New Review", callback_data: "post_review" },
            { text: "🏠 Main Menu", callback_data: "main_menu" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Cancel review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to cancel review. Please try again."
      );
    }
  }

  private async handleEditReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      // Delegate to ReviewEditHandler
      await this.reviewEditHandler.handleEditReviewCallback(
        userId,
        chatId,
        data,
        messageId || 0
      );
    } catch (error) {
      console.error("Edit review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to edit review. Please try again."
      );
    }
  }

  // Text input handlers
  private async handleReviewTextInput(
    text: string,
    userId: string,
    chatId: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(chatId, "Invalid state for text input.");
        return;
      }

      // Validate text length
      if (text.length > 2000) {
        await this.bot.sendMessage(
          chatId,
          "❌ **Review text too long**\n\n" +
          `Your review is ${text.length} characters long, but the maximum allowed is 2000 characters.\n\n` +
          "Please shorten your review and try again:"
        );
        return;
      }

      // Update state with review text
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: "anonymity_selection",
          text: text.trim(),
          waitingForReviewText: false,
        }
      );

      const message =
        `✍️ **Post a Course Review**\n\n` +
        `**Step 5 of 5:** Choose anonymity setting\n\n` +
        `**${stateData.data.courseName}**\n` +
        `Overall: ${"⭐".repeat(stateData.data.ratings.overall)}\n` +
        `Quality: ${"⭐".repeat(stateData.data.ratings.quality)}\n` +
        `Difficulty: ${"⭐".repeat(stateData.data.ratings.difficulty)}\n\n` +
        `**Your Review:** ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}\n\n` +
        `Would you like to post this review anonymously?\n\n` +
        `• **Anonymous:** Other students won't see your name\n` +
        `• **Public:** Your name will be visible to other students`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "🕶️ Post Anonymously",
              callback_data: "review_anonymous_yes",
            },
            { text: "👤 Post Publicly", callback_data: "review_anonymous_no" },
          ],
          [
            { text: "✏️ Edit Text", callback_data: "edit_review_text" },
            { text: "❌ Cancel", callback_data: "cancel_review" },
          ],
        ],
      };

      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("Review text input failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to save review text. Please try again."
      );
    }
  }

  private async handleAddTextReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(chatId, "Invalid state for text input.");
        return;
      }

      // Update state to wait for text input
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: "text_input",
          waitingForReviewText: true,
        }
      );

      const message =
        `✍️ **Post a Course Review**\n\n` +
        `**Step 4 of 5:** Write your detailed review\n\n` +
        `**${stateData.data.courseName}**\n` +
        `Overall: ${"⭐".repeat(stateData.data.ratings.overall)}\n` +
        `Quality: ${"⭐".repeat(stateData.data.ratings.quality)}\n` +
        `Difficulty: ${"⭐".repeat(stateData.data.ratings.difficulty)}\n\n` +
        `Please type your detailed review (max 2000 characters):\n\n` +
        `💡 **Tips for a helpful review:**\n` +
        `• Share specific details about course content\n` +
        `• Mention the teaching style and materials\n` +
        `• Describe the workload and assignments\n` +
        `• Give advice for future students`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: "⏭️ Skip Text Review", callback_data: "skip_text_review" },
            { text: "❌ Cancel", callback_data: "cancel_review" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Add text review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to start text input. Please try again."
      );
    }
  }

  private async handleEditCurrentReviewCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for review editing."
        );
        return;
      }

      // Show edit options
      const message =
        `✏️ **Edit Review**\n\n` +
        `**${stateData.data.courseName}**\n` +
        `Overall: ${"⭐".repeat(stateData.data.ratings.overall || 0)}\n` +
        `Quality: ${"⭐".repeat(stateData.data.ratings.quality || 0)}\n` +
        `Difficulty: ${"⭐".repeat(stateData.data.ratings.difficulty || 0)}\n` +
        `Visibility: ${stateData.data.anonymous ? "🕶️ Anonymous" : "👤 Public"}\n\n` +
        `What would you like to edit?`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "⭐ Edit Ratings",
              callback_data: `review_course_${stateData.data.courseId}`,
            },
            { text: "✍️ Edit Text", callback_data: "add_text_review" },
          ],
          [
            { text: "🕶️ Change Visibility", callback_data: "edit_anonymity" },
            {
              text: "🔙 Back to Confirmation",
              callback_data: `review_anonymous_${stateData.data.anonymous ? "yes" : "no"}`,
            },
          ],
          [{ text: "❌ Cancel", callback_data: "cancel_review" }],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Edit current review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to show edit options. Please try again."
      );
    }
  }

  private async handleMyReviewsCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      // Set user state to viewing my reviews
      await this.stateManager.setState(
        userId,
        ConversationState.VIEWING_MY_REVIEWS
      );

      // Parse page number from data (format: "my_reviews" or "my_reviews_page_X")
      let page = 1;
      if (data.includes("_page_")) {
        const pageMatch = data.match(/_page_(\d+)/);
        if (pageMatch) {
          page = parseInt(pageMatch[1]);
        }
      }

      // Get user's reviews
      const userReviews = await this.reviewService.getUserReviews(userId);

      if (userReviews.length === 0) {
        // Show empty state
        const message =
          `📝 **My Reviews**\n\n` +
          `You haven't written any course reviews yet!\n\n` +
          `**Ready to share your experience?**\n` +
          `Write your first review to help other students make informed decisions about their courses.`;

        const keyboard = {
          inline_keyboard: [
            [{ text: "✍️ Write New Review", callback_data: "post_review" }],
            [{ text: "📚 Browse Courses", callback_data: "browse_courses" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ],
        };

        if (messageId) {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } else {
          await this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }
        return;
      }

      // Pagination settings
      const reviewsPerPage = 5;
      const totalPages = Math.ceil(userReviews.length / reviewsPerPage);
      const startIndex = (page - 1) * reviewsPerPage;
      const endIndex = startIndex + reviewsPerPage;
      const pageReviews = userReviews.slice(startIndex, endIndex);

      // Get course details for each review
      const reviewsWithCourseInfo = await Promise.all(
        pageReviews.map(async (review) => {
          const courseDetails = await this.courseService.getCourseDetails(
            review.courseId
          );
          return {
            ...review,
            courseName: courseDetails?.name || review.courseId,
            categoryEmoji: UIComponents.getCategoryEmoji(
              review.courseId.substring(0, 3)
            ),
          };
        })
      );

      // Build message
      let message = `📝 **My Reviews** (${userReviews.length} total)\n\n`;

      reviewsWithCourseInfo.forEach((review, index) => {
        const reviewNumber = startIndex + index + 1;
        const createdDate = new Date(review.createdAt).toLocaleDateString();
        const visibilityIcon = review.anonymous ? "👤" : "👥";
        const visibilityText = review.anonymous ? "Anonymous" : "Public";

        // Truncate review text for display
        const displayText = review.text
          ? review.text.length > 100
            ? `${review.text.substring(0, 100)}... `
            : review.text
          : "_No text provided_";
        message += `**${reviewNumber}. ${review.categoryEmoji} ${review.courseId} - ${review.courseName}**\n`;
        message += `⭐ Overall: ${"⭐".repeat(
          review.ratings.overall
        )}${"☆".repeat(5 - review.ratings.overall)} (${review.ratings.overall
          }.0)\n`;
        message += `📅 Posted: ${createdDate}\n`;
        message += `${visibilityIcon} ${visibilityText}\n`;
        if (review.text) {
          message += `💬 ${displayText}\n`;
        }
        message += `\n`;
      });

      // Create keyboard with review management buttons
      const keyboard = this.createMyReviewsKeyboard(
        pageReviews,
        page,
        totalPages
      );

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      console.error("My reviews callback failed:", error);
      await this.sendErrorMessage(chatId, "Failed to load your reviews.");
    }
  }

  private async handleWriteReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^write_review_(.+)$/);
      const courseId = match?.[1];

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      // Start the review posting process for this specific course
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        { step: "rating_overall", courseId }
      );

      // Redirect to the review course callback
      await this.handleReviewCourseCallback(
        userId,
        chatId,
        `review_course_${courseId}`,
        messageId
      );
    } catch (error) {
      console.error("Write review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to start review. Please try again."
      );
    }
  }

  private async handleEditAnonymityCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(
          chatId,
          "Invalid state for anonymity editing."
        );
        return;
      }

      const message =
        `✏️ **Edit Anonymity Setting**\n\n` +
        `**${stateData.data.courseName}**\n\n` +
        `Current setting: ${stateData.data.anonymous ? "🕶️ Anonymous" : "👤 Public"}\n\n` +
        `Choose your new anonymity setting:`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "🕶️ Post Anonymously",
              callback_data: "review_anonymous_yes",
            },
            { text: "👤 Post Publicly", callback_data: "review_anonymous_no" },
          ],
          [
            {
              text: "🔙 Back to Confirmation",
              callback_data: `review_anonymous_${stateData.data.anonymous ? "yes" : "no"}`,
            },
            { text: "❌ Cancel", callback_data: "cancel_review" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Edit anonymity callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to edit anonymity. Please try again."
      );
    }
  }

  private async handleEditReviewTextCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(chatId, "Invalid state for text editing.");
        return;
      }

      // Update state to wait for text input
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: "text_input",
          waitingForReviewText: true,
        }
      );

      const currentText = stateData.data.text
        ? `\n\n**Current text:**\n${stateData.data.text}`
        : "";

      const message =
        `✏️ **Edit Review Text**\n\n` +
        `**${stateData.data.courseName}**${currentText}\n\n` +
        `Please type your new detailed review (max 2000 characters):\n\n` +
        `💡 **Tips for a helpful review:**\n` +
        `• Share specific details about course content\n` +
        `• Mention the teaching style and materials\n` +
        `• Describe the workload and assignments\n` +
        `• Give advice for future students`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🗑️ Remove Text", callback_data: "remove_review_text" },
            { text: "❌ Cancel", callback_data: "cancel_review" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Edit review text callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to edit review text. Please try again."
      );
    }
  }

  private async handleRemoveReviewTextCallback(
    userId: string,
    chatId: number,
    _data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const stateData = await this.stateManager.getState(userId);
      if (
        stateData?.state !== ConversationState.POSTING_REVIEW ||
        !stateData.data?.courseId
      ) {
        await this.sendErrorMessage(chatId, "Invalid state for text removal.");
        return;
      }

      // Remove the text from the review
      await this.stateManager.setState(
        userId,
        ConversationState.POSTING_REVIEW,
        {
          ...stateData.data,
          step: "anonymity_selection",
          text: undefined,
          waitingForReviewText: false,
        }
      );

      // Redirect to anonymity selection
      await this.handleSkipTextReviewCallback(
        userId,
        chatId,
        "skip_text_review",
        messageId
      );
    } catch (error) {
      console.error("Remove review text callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to remove review text. Please try again."
      );
    }
  }

  private async handleManageReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const reviewId = data.replace("manage_review_", "");

      // Get the specific review
      const userReviews = await this.reviewService.getUserReviews(userId);
      const review = userReviews.find((r) => r.reviewId === reviewId);

      if (!review) {
        await this.bot.editMessageText(
          "❌ Review not found or you don't have permission to manage it.",
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🔙 Back to My Reviews",
                    callback_data: "my_reviews",
                  },
                ],
              ],
            },
          }
        );
        return;
      }

      // Get course details
      const courseDetails = await this.courseService.getCourseDetails(
        review.courseId
      );
      const courseName = courseDetails?.name || review.courseId;
      const categoryEmoji = UIComponents.getCategoryEmoji(
        review.courseId.substring(0, 3)
      );

      const createdDate = new Date(review.createdAt).toLocaleDateString();
      const visibilityText = review.anonymous ? "Anonymous" : "Public";
      const visibilityIcon = review.anonymous ? "👤" : "👥";

      let message = `📝 **Review Management**\n\n`;
      message += `**${categoryEmoji} ${courseName}**\n\n`;
      message += `⭐ **Ratings:**\n`;
      message += `• Overall: ${"⭐".repeat(review.ratings.overall)}${"☆".repeat(
        5 - review.ratings.overall
      )} (${review.ratings.overall}/5)\n`;
      message += `• Quality: ${"⭐".repeat(review.ratings.quality)}${"☆".repeat(
        5 - review.ratings.quality
      )} (${review.ratings.quality}/5)\n`;
      message += `• Difficulty: ${"⭐".repeat(
        review.ratings.difficulty
      )}${"☆".repeat(5 - review.ratings.difficulty)} (${review.ratings.difficulty
        }/5)\n\n`;
      message += `${visibilityIcon} **Visibility:** ${visibilityText}\n`;
      message += `📅 **Posted:** ${createdDate}\n\n`;

      if (review.text) {
        message += `💬 **Review Text:**\n${review.text}\n\n`;
      }

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "✏️ Edit Review",
              callback_data: `edit_review_${reviewId}`,
            },
            {
              text: "🗑️ Delete Review",
              callback_data: `delete_review_${reviewId}`,
            },
          ],
          [
            {
              text: "📊 View Course",
              callback_data: `course_${review.courseId}`,
            },
          ],
          [
            { text: "🔙 Back to My Reviews", callback_data: "my_reviews" },
            { text: "🏠 Main Menu", callback_data: "main_menu" },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      console.error("Manage review callback failed:", error);
      await this.sendErrorMessage(chatId, "Failed to load review details.");
    }
  }

  private async handleDeleteReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const reviewId = data.replace("delete_review_", "");

      // Get the review for confirmation display
      const userReviews = await this.reviewService.getUserReviews(userId);
      const review = userReviews.find((r) => r.reviewId === reviewId);

      if (!review) {
        await this.bot.editMessageText(
          "❌ Review not found or you don't have permission to delete it.",
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🔙 Back to My Reviews",
                    callback_data: "my_reviews",
                  },
                ],
              ],
            },
          }
        );
        return;
      }

      const courseDetails = await this.courseService.getCourseDetails(
        review.courseId
      );
      const courseName = courseDetails?.name || review.courseId;

      const message =
        `🗑️ **Delete Review Confirmation**\n\n` +
        `Are you sure you want to delete your review for **${courseName}**?\n\n` +
        `⚠️ **This action cannot be undone!**\n\n` +
        `Your review will be permanently removed and will no longer be visible to other students.`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "🗑️ Yes, Delete",
              callback_data: `confirm_delete_${reviewId}`,
            },
            { text: "❌ Cancel", callback_data: `manage_review_${reviewId}` },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      console.error("Delete review callback failed:", error);
      await this.sendErrorMessage(chatId, "Failed to process delete request.");
    }
  }

  private async handleConfirmDeleteReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const reviewId = data.replace("confirm_delete_", "");

      // Delete the review
      await this.reviewService.deleteReview(reviewId, userId);

      const message =
        `✅ **Review Deleted Successfully**\n\n` +
        `Your review has been permanently removed.`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "⭐ My Reviews", callback_data: "my_reviews" }],
          [{ text: "✍️ Write New Review", callback_data: "post_review" }],
          [{ text: "📚 Browse Courses", callback_data: "browse_courses" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      console.error("Confirm delete review callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to delete review. Please try again."
      );
    }
  }

  /**
   * Create keyboard for My Reviews with pagination and review management buttons
   */
  private createMyReviewsKeyboard(
    reviews: any[],
    currentPage: number,
    totalPages: number
  ): any {
    const keyboard: any[][] = [];

    // Add individual review buttons
    reviews.forEach((review, index) => {
      const reviewNumber = (currentPage - 1) * 5 + index + 1;
      keyboard.push([
        {
          text: `📝 Review ${reviewNumber}`,
          callback_data: `manage_review_${review.reviewId}`,
        },
      ]);
    });

    // Add pagination controls if needed
    if (totalPages > 1) {
      const paginationRow: any[] = [];

      if (currentPage > 1) {
        paginationRow.push({
          text: "◀️ Previous",
          callback_data: `my_reviews_page_${currentPage - 1}`,
        });
      }

      paginationRow.push({
        text: `${currentPage}/${totalPages}`,
        callback_data: "noop",
      });

      if (currentPage < totalPages) {
        paginationRow.push({
          text: "Next ▶️",
          callback_data: `my_reviews_page_${currentPage + 1}`,
        });
      }

      keyboard.push(paginationRow);
    }

    // Add action buttons
    keyboard.push([
      { text: "✍️ Write New Review", callback_data: "post_review" },
    ]);

    keyboard.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);

    return { inline_keyboard: keyboard };
  }

  // Helper methods for sending messages
  private async sendErrorMessage(
    chatId: number,
    message: string
  ): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, `❌ ${message}`);
    } catch (error) {
      console.error("Failed to send error message:", error);
    }
  }

  private async sendUnknownCommandMessage(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      "❓ Unknown command. Use /help to see available commands."
    );
  }

  private async sendUnknownInputMessage(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      "❓ I don't understand that input. Please use the buttons or commands to interact with the bot."
    );
  }

  private async sendUnknownCallbackMessage(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      "❓ Unknown action. Please try again or use /help for assistance."
    );
  }

  private createResponse(statusCode: number, body: any): APIGatewayProxyResult {
    return {
      statusCode,
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  private async handleHelpCallback(
    _userId: string,
    chatId: number,
    _data: string,
    _messageId?: number
  ): Promise<void> {
    const helpText =
      "🤖 PickYourCourses Bot Help\n\n" +
      "📚 Available commands:\n" +
      "• /start - Start the bot and go to the main menu\n" +
      "• /help - Show this help message\n\n" +
      "🎓 About this bot:\n" +
      "PickYourCourses helps École Polytechnique students share and read course reviews. " +
      "You can browse reviews by category, post your own experiences, and vote on helpful reviews.\n\n" +
      "❓ For support, contact Alexandre Bismuth (@alex_bsmth).";

    await this.bot.sendMessage(chatId, helpText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
        ],
      },
    });
  }

  // Review reading workflow handlers
  private async handleViewReviewsCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^reviews_(.+)$/);
      const courseId = match?.[1];

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      await this.displayReviewsForCourse(
        userId,
        chatId,
        courseId,
        1,
        messageId
      );
    } catch (error) {
      console.error("View reviews callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load reviews. Please try again."
      );
    }
  }

  private async handleReviewsPageCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^reviews_(.+)_page_(\d+)$/);
      const courseId = match?.[1];
      const page = parseInt(match?.[2] || "1");

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      await this.displayReviewsForCourse(
        userId,
        chatId,
        courseId,
        page,
        messageId
      );
    } catch (error) {
      console.error("Reviews page callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load reviews. Please try again."
      );
    }
  }

  private async handleVoteCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^vote_(.+)_(up|down)$/);
      const reviewId = match?.[1];
      const voteType = match?.[2] as "up" | "down";

      if (!reviewId || !voteType) {
        await this.sendErrorMessage(chatId, "Invalid vote action.");
        return;
      }

      // Cast the vote
      await this.reviewService.voteOnReview(userId, reviewId, voteType);

      // Get the review to find the course ID for refresh
      const { ReviewRepository } = await import(
        "../database/repositories/review"
      );
      const { DynamoDBClient } = await import("../database/client");
      const documentClient = DynamoDBClient.getInstance().getDocumentClient();
      const reviewRepo = new ReviewRepository(documentClient);
      const reviewData = await reviewRepo.get(reviewId);

      if (reviewData) {
        await this.displayReviewsForCourse(
          userId,
          chatId,
          reviewData.courseId,
          1,
          messageId
        );
      }

      // Show success message briefly
      await this.bot.answerCallbackQuery(data, {
        text: `Vote ${voteType === "up" ? "👍" : "👎"} recorded!`,
        show_alert: false,
      });
    } catch (error: any) {
      console.error("Vote callback failed:", error);

      let errorMessage = "Failed to record vote.";
      if (error.message.includes("own reviews")) {
        errorMessage = "You cannot vote on your own reviews.";
      } else if (error.message.includes("deleted")) {
        errorMessage = "Cannot vote on deleted reviews.";
      }

      await this.bot.answerCallbackQuery(data, {
        text: errorMessage,
        show_alert: true,
      });
    }
  }

  private async handleCourseDetailsCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^course_details_(.+)$/);
      const courseId = match?.[1];

      if (!courseId) {
        await this.sendErrorMessage(chatId, "Invalid course selected.");
        return;
      }

      // Redirect to course callback
      await this.handleCourseCallback(
        userId,
        chatId,
        `course_${courseId}`,
        messageId
      );
    } catch (error) {
      console.error("Course details callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load course details. Please try again."
      );
    }
  }

  private async handleCoursesPageCallback(
    _userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      const match = data.match(/^courses_(.+)_page_(\d+)$/);
      const category = match?.[1] as CourseCategory;
      const page = parseInt(match?.[2] || "1");

      if (!category || !this.courseService.isValidCategory(category)) {
        await this.sendErrorMessage(chatId, "Invalid category selected.");
        return;
      }

      // Get courses in the selected category
      const courses = await this.courseService.getCoursesByCategory(category);

      // Display courses with pagination
      const { keyboard, pagination } = UIComponents.createCourseList(
        courses.map((course) => ({
          courseId: course.courseId,
          name: course.name,
          ...(course.averageRatings.overall > 0 && {
            averageRating: course.averageRatings.overall,
          }),
        })),
        category,
        page
      );

      const categoryEmoji = UIComponents.getCategoryEmoji(category);
      const message =
        `📚 **${categoryEmoji} ${category} Courses**\n\n` +
        `Found ${courses.length} course${courses.length !== 1 ? "s" : ""} in this category.\n\n` +
        `Page ${pagination.currentPage} of ${pagination.totalPages}\n\n` +
        "Select a course to view details and reviews:";

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Courses page callback failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load courses. Please try again."
      );
    }
  }

  /**
   * Display reviews for a course with pagination and voting
   */
  private async displayReviewsForCourse(
    userId: string,
    chatId: number,
    courseId: string,
    page: number = 1,
    messageId?: number
  ): Promise<void> {
    try {
      // Get course details
      const courseDetails = await this.courseService.getCourseDetails(courseId);
      if (!courseDetails) {
        await this.sendErrorMessage(chatId, "Course not found.");
        return;
      }

      // Get reviews for the course
      const reviews = await this.reviewService.getReviewsForCourse(
        courseId,
        "upvotes"
      );

      if (reviews.length === 0) {
        const categoryEmoji = UIComponents.getCategoryEmoji(
          courseDetails.category
        );
        const message =
          `📚 **${categoryEmoji} ${courseDetails.courseId} - ${courseDetails.name}**\n\n` +
          "📝 **No reviews yet**\n\n" +
          "Be the first to share your experience with this course!\n\n" +
          "Your review will help other students make informed decisions.";

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "✍️ Write First Review",
                callback_data: `write_review_${courseId}`,
              },
            ],
            [
              {
                text: "🔙 Back to Course",
                callback_data: `course_${courseId}`,
              },
              { text: "🏠 Main Menu", callback_data: "main_menu" },
            ],
          ],
        };

        if (messageId) {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        } else {
          await this.bot.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        }
        return;
      }

      // Get user votes for all reviews
      const reviewsWithUserVotes = await Promise.all(
        reviews.map(async (review) => {
          const userVote = await this.reviewService.getUserVoteForReview(
            userId,
            review.reviewId
          );

          // Get reviewer information for public reviews
          let reviewerInfo = null;
          if (!review.anonymous) {
            const reviewer = await this.userRepository.get(review.userId) as User & {
              name?: string;
              promotion?: string;
            };
            if (reviewer?.name && reviewer?.promotion) {
              reviewerInfo = {
                name: reviewer.name,
                promotion: reviewer.promotion
              };
            }
          }

          return {
            ...review,
            userVote,
            reviewerInfo,
          };
        })
      );

      // Create paginated review list
      const { keyboard, pagination } = UIComponents.createReviewList(
        reviewsWithUserVotes,
        courseId,
        page
      );

      // Build message with course info and reviews
      const categoryEmoji = UIComponents.getCategoryEmoji(
        courseDetails.category
      );
      let message = `📚 **${categoryEmoji} ${courseDetails.courseId} - ${courseDetails.name}**\n\n`;
      message += `📝 **Reviews (${reviews.length})**\n`;
      message += `Page ${pagination.currentPage} of ${pagination.totalPages}\n\n`;

      // Add individual reviews
      const startIndex = (page - 1) * 5;
      const endIndex = Math.min(startIndex + 5, reviews.length);
      const pageReviews = reviewsWithUserVotes.slice(startIndex, endIndex);

      pageReviews.forEach((review, index) => {
        const reviewNumber = startIndex + index + 1;
        let authorText = "Anonymous";

        if (!review.anonymous) {
          if (review.reviewerInfo?.name && review.reviewerInfo?.promotion) {
            authorText = `${review.reviewerInfo.name} (${review.reviewerInfo.promotion})`;
          } else {
            authorText = "Student"; // Fallback for old reviews without profile info
          }
        }

        const netVotes = review.upvotes - review.downvotes;
        const voteText = netVotes > 0 ? `+${netVotes}` : netVotes.toString();

        message += `**Review ${reviewNumber}** by ${authorText} (${voteText} votes)\n`;
        message += `⭐ Overall: ${review.ratings.overall}/5 | Quality: ${review.ratings.quality}/5 | Difficulty: ${review.ratings.difficulty}/5\n`;

        if (review.text) {
          const truncatedText =
            review.text.length > 150
              ? review.text.substring(0, 150) + "..."
              : review.text;
          message += `💬 "${truncatedText}"\n`;
        }
        message += "\n";
      });

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error("Display reviews failed:", error);
      await this.sendErrorMessage(
        chatId,
        "Failed to load reviews. Please try again."
      );
    }
  }

  // Review editing wrapper methods
  private async handleEditRatingCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    try {
      await this.reviewEditHandler.handleEditRatingCallback(
        userId,
        chatId,
        data,
        messageId || 0
      );
    } catch (error) {
      console.error("WebhookHandler: Edit rating callback failed:", error);
      await this.bot.sendMessage(
        chatId,
        "❌ Failed to load rating editor. Please try again."
      );
    }
  }

  private async handleSetRatingCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    await this.reviewEditHandler.handleSetRatingCallback(
      userId,
      chatId,
      data,
      messageId || 0
    );
  }

  private async handleEditTextCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    await this.reviewEditHandler.handleEditTextCallback(
      userId,
      chatId,
      data,
      messageId || 0
    );
  }

  private async handleEditAnonymousCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    await this.reviewEditHandler.handleEditAnonymousCallback(
      userId,
      chatId,
      data,
      messageId || 0
    );
  }

  private async handleSaveReviewCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    await this.reviewEditHandler.handleSaveReviewCallback(
      userId,
      chatId,
      data,
      messageId || 0
    );
  }

  private async handleCancelEditCallback(
    userId: string,
    chatId: number,
    data: string,
    messageId?: number
  ): Promise<void> {
    await this.reviewEditHandler.handleCancelEditCallback(
      userId,
      chatId,
      data,
      messageId || 0
    );
  }
}
