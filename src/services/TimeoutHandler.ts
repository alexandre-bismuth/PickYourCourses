import { StateManager } from './StateManager';

/**
 * Handles session timeout warnings and cleanup
 */
export class TimeoutHandler {
  private stateManager: StateManager;
  private timeoutWarnings: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private sessionTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly WARNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private readonly SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Start timeout timers for a user session
   */
  async startTimeoutTimers(
    userId: string,
    onWarning: (userId: string) => Promise<void>,
    onTimeout: (userId: string) => Promise<void>
  ): Promise<void> {
    // Clear any existing timers
    this.clearTimeoutTimers(userId);

    // Set warning timer (10 minutes)
    const warningTimer = setTimeout(async () => {
      try {
        const sessionInfo = await this.stateManager.getSessionTimeoutInfo(userId);
        if (sessionInfo && !sessionInfo.isExpired && sessionInfo.needsWarning) {
          await onWarning(userId);
        }
      } catch (error) {
        console.error(`Error sending timeout warning to user ${userId}:`, error);
      }
    }, this.WARNING_TIMEOUT_MS);

    // Set session timeout timer (15 minutes)
    const sessionTimer = setTimeout(async () => {
      try {
        const isExpired = await this.stateManager.isSessionExpired(userId);
        if (isExpired) {
          await this.stateManager.clearState(userId);
          await onTimeout(userId);
        }
      } catch (error) {
        console.error(`Error handling session timeout for user ${userId}:`, error);
      } finally {
        // Clean up timers
        this.clearTimeoutTimers(userId);
      }
    }, this.SESSION_TIMEOUT_MS);

    // Store timers
    this.timeoutWarnings.set(userId, warningTimer);
    this.sessionTimeouts.set(userId, sessionTimer);
  }

  /**
   * Clear timeout timers for a user
   */
  clearTimeoutTimers(userId: string): void {
    const warningTimer = this.timeoutWarnings.get(userId);
    const sessionTimer = this.sessionTimeouts.get(userId);

    if (warningTimer) {
      clearTimeout(warningTimer);
      this.timeoutWarnings.delete(userId);
    }

    if (sessionTimer) {
      clearTimeout(sessionTimer);
      this.sessionTimeouts.delete(userId);
    }
  }

  /**
   * Renew session and restart timeout timers
   */
  async renewSession(
    userId: string,
    onWarning: (userId: string) => Promise<void>,
    onTimeout: (userId: string) => Promise<void>
  ): Promise<void> {
    await this.stateManager.renewSession(userId);
    await this.startTimeoutTimers(userId, onWarning, onTimeout);
  }

  /**
   * Check if user needs immediate timeout warning
   */
  async checkImmediateWarning(userId: string): Promise<boolean> {
    return await this.stateManager.needsTimeoutWarning(userId);
  }

  /**
   * Check if user session has expired
   */
  async checkSessionExpired(userId: string): Promise<boolean> {
    return await this.stateManager.isSessionExpired(userId);
  }

  /**
   * Get remaining time until warning and expiry
   */
  async getTimeoutInfo(userId: string): Promise<{
    timeUntilWarning: number;
    timeUntilExpiry: number;
    isExpired: boolean;
    needsWarning: boolean;
  } | null> {
    return await this.stateManager.getSessionTimeoutInfo(userId);
  }

  /**
   * Handle user activity - renew session and reset timers
   */
  async handleUserActivity(
    userId: string,
    onWarning: (userId: string) => Promise<void>,
    onTimeout: (userId: string) => Promise<void>
  ): Promise<void> {
    // Check if session exists and is not expired
    const sessionExpired = await this.checkSessionExpired(userId);

    if (!sessionExpired) {
      // Renew session and restart timers
      await this.renewSession(userId, onWarning, onTimeout);
    }
  }

  /**
   * Cleanup all timers (useful for shutdown)
   */
  cleanup(): void {
    // Clear all warning timers
    for (const timer of this.timeoutWarnings.values()) {
      clearTimeout(timer);
    }
    this.timeoutWarnings.clear();

    // Clear all session timers
    for (const timer of this.sessionTimeouts.values()) {
      clearTimeout(timer);
    }
    this.sessionTimeouts.clear();
  }

  /**
   * Get active timer count (for monitoring/debugging)
   */
  getActiveTimerCount(): { warnings: number; sessions: number } {
    return {
      warnings: this.timeoutWarnings.size,
      sessions: this.sessionTimeouts.size
    };
  }

  /**
   * Force timeout for a user (useful for testing or admin actions)
   */
  async forceTimeout(
    userId: string,
    onTimeout: (userId: string) => Promise<void>
  ): Promise<void> {
    this.clearTimeoutTimers(userId);
    await this.stateManager.clearState(userId);
    await onTimeout(userId);
  }

  /**
   * Batch cleanup expired sessions (utility method for periodic cleanup)
   */
  async cleanupExpiredSessions(): Promise<void> {
    await this.stateManager.cleanupExpiredSessions();
  }
}