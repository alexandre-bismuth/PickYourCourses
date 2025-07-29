import { ConversationState } from '../models';

/**
 * Simple in-memory state manager
 */
export class StateManager {
  private states: Map<string, { state: ConversationState; data?: any; lastActivity: Date }> = new Map();
  private readonly STATE_TIMEOUT_MINUTES = 30;

  /**
   * Set user's conversation state with optional context data
   */
  async setState(userId: string, state: ConversationState, data?: any): Promise<void> {
    this.states.set(userId, {
      state,
      data: data || null,
      lastActivity: new Date()
    });
  }

  /**
   * Get user's current conversation state
   */
  async getState(userId: string): Promise<{ state: ConversationState; data?: any } | null> {
    const stateData = this.states.get(userId);

    if (!stateData) {
      return null;
    }

    // Check if state has expired
    const now = new Date();
    const expiredTime = new Date(stateData.lastActivity.getTime() + this.STATE_TIMEOUT_MINUTES * 60 * 1000);

    if (now > expiredTime) {
      this.states.delete(userId);
      return null;
    }

    return {
      state: stateData.state,
      data: stateData.data
    };
  }

  /**
   * Clear user's conversation state
   */
  async clearState(userId: string): Promise<void> {
    this.states.delete(userId);
  }

  /**
   * Update last activity timestamp for a user's session
   */
  async renewSession(userId: string): Promise<void> {
    const stateData = this.states.get(userId);
    if (stateData) {
      stateData.lastActivity = new Date();
      this.states.set(userId, stateData);
    }
  }

  /**
   * Check if a state transition is valid
   */
  isValidTransition(from: ConversationState, to: ConversationState): boolean {
    // Define valid state transitions
    const validTransitions: { [key in ConversationState]: ConversationState[] } = {
      [ConversationState.MAIN_MENU]: [
        ConversationState.BROWSING_CATEGORIES,
        ConversationState.POSTING_REVIEW,
        ConversationState.VIEWING_MY_REVIEWS
      ],
      [ConversationState.BROWSING_CATEGORIES]: [
        ConversationState.MAIN_MENU,
        ConversationState.VIEWING_COURSE
      ],
      [ConversationState.VIEWING_COURSE]: [
        ConversationState.BROWSING_CATEGORIES,
        ConversationState.MAIN_MENU,
        ConversationState.POSTING_REVIEW
      ],
      [ConversationState.POSTING_REVIEW]: [
        ConversationState.MAIN_MENU,
        ConversationState.VIEWING_COURSE,
        ConversationState.COLLECTING_NAME
      ],
      [ConversationState.COLLECTING_USER_INFO]: [
        ConversationState.MAIN_MENU,
        ConversationState.COLLECTING_NAME
      ],
      [ConversationState.COLLECTING_NAME]: [
        ConversationState.MAIN_MENU,
        ConversationState.COLLECTING_PROMOTION
      ],
      [ConversationState.COLLECTING_PROMOTION]: [
        ConversationState.MAIN_MENU,
        ConversationState.POSTING_REVIEW
      ],
      [ConversationState.VIEWING_MY_REVIEWS]: [
        ConversationState.MAIN_MENU,
        ConversationState.POSTING_REVIEW,
        ConversationState.VIEWING_COURSE,
        ConversationState.EDITING_REVIEW
      ],
      [ConversationState.EDITING_REVIEW]: [
        ConversationState.VIEWING_MY_REVIEWS,
        ConversationState.MAIN_MENU,
        ConversationState.EDITING_REVIEW_TEXT
      ],
      [ConversationState.EDITING_REVIEW_TEXT]: [
        ConversationState.EDITING_REVIEW,
        ConversationState.VIEWING_MY_REVIEWS,
        ConversationState.MAIN_MENU
      ]
    };

    // Always allow transition back to main menu
    if (to === ConversationState.MAIN_MENU) {
      return true;
    }

    return validTransitions[from]?.includes(to) || false;
  }

  /**
   * Clean up expired states
   */
  private cleanupExpiredStates(): void {
    const now = new Date();
    for (const [userId, stateData] of this.states.entries()) {
      const expiredTime = new Date(stateData.lastActivity.getTime() + this.STATE_TIMEOUT_MINUTES * 60 * 1000);
      if (now > expiredTime) {
        this.states.delete(userId);
      }
    }
  }

  /**
   * Start periodic cleanup of expired states
   */
  startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredStates();
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  }

  /**
   * Get session timeout information for a user
   */
  async getSessionTimeoutInfo(userId: string): Promise<{ timeUntilWarning: number; timeUntilExpiry: number; isExpired: boolean; needsWarning: boolean } | null> {
    const stateData = this.states.get(userId);

    if (!stateData) {
      return null;
    }

    const now = new Date();
    const timeElapsed = now.getTime() - stateData.lastActivity.getTime();
    const timeUntilExpiry = (this.STATE_TIMEOUT_MINUTES * 60 * 1000) - timeElapsed;
    const warningThreshold = 5 * 60 * 1000; // 5 minutes warning
    const timeUntilWarning = timeUntilExpiry - warningThreshold;

    return {
      timeUntilWarning: Math.max(0, timeUntilWarning),
      timeUntilExpiry: Math.max(0, timeUntilExpiry),
      isExpired: timeUntilExpiry <= 0,
      needsWarning: timeUntilExpiry <= warningThreshold && timeUntilExpiry > 0
    };
  }

  /**
   * Check if a user's session is expired
   */
  async isSessionExpired(userId: string): Promise<boolean> {
    const stateData = this.states.get(userId);

    if (!stateData) {
      return true;
    }

    const now = new Date();
    const expiredTime = new Date(stateData.lastActivity.getTime() + this.STATE_TIMEOUT_MINUTES * 60 * 1000);

    return now > expiredTime;
  }

  /**
   * Check if a user needs a timeout warning
   */
  async needsTimeoutWarning(userId: string): Promise<boolean> {
    const timeoutInfo = await this.getSessionTimeoutInfo(userId);
    return timeoutInfo?.needsWarning || false;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    this.cleanupExpiredStates();
  }
}