/**
 * Lambda optimization utilities for connection reuse and performance
 */

import { Logger, LogCategory } from './Logger';

const logger = Logger.getInstance();

/**
 * Connection pool manager for Lambda optimization
 */
export class ConnectionPoolManager {
    private static instance: ConnectionPoolManager;
    private connections: Map<string, any> = new Map();
    private lastUsed: Map<string, number> = new Map();
    private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes

    private constructor() { }

    static getInstance(): ConnectionPoolManager {
        if (!ConnectionPoolManager.instance) {
            ConnectionPoolManager.instance = new ConnectionPoolManager();
        }
        return ConnectionPoolManager.instance;
    }

    /**
     * Store a connection for reuse
     */
    storeConnection(key: string, connection: any): void {
        this.connections.set(key, connection);
        this.lastUsed.set(key, Date.now());

        logger.debug(LogCategory.SYSTEM, 'Connection stored for reuse', {
            connectionKey: key,
            totalConnections: this.connections.size
        });
    }

    /**
     * Get a stored connection
     */
    getConnection(key: string): any | null {
        const connection = this.connections.get(key);
        if (!connection) {
            return null;
        }

        const lastUsedTime = this.lastUsed.get(key) || 0;
        const now = Date.now();

        // Check if connection has expired
        if (now - lastUsedTime > this.TTL_MS) {
            this.connections.delete(key);
            this.lastUsed.delete(key);

            logger.debug(LogCategory.SYSTEM, 'Connection expired and removed', {
                connectionKey: key,
                ageMs: now - lastUsedTime
            });

            return null;
        }

        // Update last used time
        this.lastUsed.set(key, now);

        logger.debug(LogCategory.SYSTEM, 'Connection retrieved for reuse', {
            connectionKey: key,
            ageMs: now - lastUsedTime
        });

        return connection;
    }

    /**
     * Clean up expired connections
     */
    cleanup(): void {
        const now = Date.now();
        const keysToRemove: string[] = [];

        for (const [key, lastUsedTime] of this.lastUsed.entries()) {
            if (now - lastUsedTime > this.TTL_MS) {
                keysToRemove.push(key);
            }
        }

        for (const key of keysToRemove) {
            this.connections.delete(key);
            this.lastUsed.delete(key);
        }

        if (keysToRemove.length > 0) {
            logger.debug(LogCategory.SYSTEM, 'Expired connections cleaned up', {
                removedCount: keysToRemove.length,
                remainingCount: this.connections.size
            });
        }
    }

    /**
     * Get connection pool statistics
     */
    getStats(): {
        totalConnections: number;
        connectionKeys: string[];
        oldestConnectionAge: number;
        newestConnectionAge: number;
    } {
        const now = Date.now();
        const ages = Array.from(this.lastUsed.values()).map(time => now - time);

        return {
            totalConnections: this.connections.size,
            connectionKeys: Array.from(this.connections.keys()),
            oldestConnectionAge: ages.length > 0 ? Math.max(...ages) : 0,
            newestConnectionAge: ages.length > 0 ? Math.min(...ages) : 0
        };
    }
}

/**
 * Lambda warm-up strategy to reduce cold starts
 */
export class WarmUpStrategy {
    private static lastWarmUp: number = 0;
    private static readonly WARM_UP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Execute warm-up procedures
     */
    static async warmUp(): Promise<void> {
        const now = Date.now();

        // Skip if recently warmed up
        if (now - this.lastWarmUp < this.WARM_UP_INTERVAL_MS) {
            logger.debug(LogCategory.SYSTEM, 'Skipping warm-up, recently executed', {
                lastWarmUpAgo: now - this.lastWarmUp
            });
            return;
        }

        logger.info(LogCategory.SYSTEM, 'Starting Lambda warm-up procedure');

        try {
            // Pre-initialize services
            const { ServiceFactory } = await import('./ServiceFactory');
            await ServiceFactory.createServices();

            // Clean up expired connections
            ConnectionPoolManager.getInstance().cleanup();

            // Log warm-up completion
            this.lastWarmUp = now;

            logger.info(LogCategory.SYSTEM, 'Lambda warm-up completed successfully', {
                duration: Date.now() - now,
                connectionPoolStats: ConnectionPoolManager.getInstance().getStats()
            });

        } catch (error) {
            logger.error(LogCategory.SYSTEM, 'Lambda warm-up failed', error);
            throw error;
        }
    }

    /**
     * Check if Lambda needs warm-up
     */
    static needsWarmUp(): boolean {
        const now = Date.now();
        return now - this.lastWarmUp > this.WARM_UP_INTERVAL_MS;
    }
}

/**
 * Performance monitoring for Lambda functions
 */
export class LambdaPerformanceMonitor {
    private static metrics: Map<string, {
        count: number;
        totalDuration: number;
        maxDuration: number;
        minDuration: number;
        errors: number;
    }> = new Map();

    /**
     * Track function execution metrics
     */
    static trackExecution(
        functionName: string,
        duration: number,
        success: boolean
    ): void {
        const existing = this.metrics.get(functionName) || {
            count: 0,
            totalDuration: 0,
            maxDuration: 0,
            minDuration: Infinity,
            errors: 0
        };

        existing.count++;
        existing.totalDuration += duration;
        existing.maxDuration = Math.max(existing.maxDuration, duration);
        existing.minDuration = Math.min(existing.minDuration, duration);

        if (!success) {
            existing.errors++;
        }

        this.metrics.set(functionName, existing);

        // Log performance metrics periodically
        if (existing.count % 10 === 0) {
            const avgDuration = existing.totalDuration / existing.count;
            const errorRate = (existing.errors / existing.count) * 100;

            logger.info(LogCategory.PERFORMANCE, 'Lambda performance metrics', {
                functionName,
                executionCount: existing.count,
                averageDuration: Math.round(avgDuration),
                maxDuration: existing.maxDuration,
                minDuration: existing.minDuration === Infinity ? 0 : existing.minDuration,
                errorRate: Math.round(errorRate * 100) / 100,
                totalErrors: existing.errors
            });
        }
    }

    /**
     * Get performance metrics for a function
     */
    static getMetrics(functionName: string): any {
        const metrics = this.metrics.get(functionName);
        if (!metrics) {
            return null;
        }

        const avgDuration = metrics.totalDuration / metrics.count;
        const errorRate = (metrics.errors / metrics.count) * 100;

        return {
            functionName,
            executionCount: metrics.count,
            averageDuration: Math.round(avgDuration),
            maxDuration: metrics.maxDuration,
            minDuration: metrics.minDuration === Infinity ? 0 : metrics.minDuration,
            errorRate: Math.round(errorRate * 100) / 100,
            totalErrors: metrics.errors
        };
    }

    /**
     * Get all performance metrics
     */
    static getAllMetrics(): any[] {
        return Array.from(this.metrics.keys()).map(functionName =>
            this.getMetrics(functionName)
        );
    }

    /**
     * Reset metrics (useful for testing)
     */
    static resetMetrics(): void {
        this.metrics.clear();
    }
}

/**
 * Memory management utilities for Lambda
 */
export class MemoryManager {
    /**
     * Force garbage collection if available
     */
    static forceGarbageCollection(): void {
        if (global.gc) {
            const before = process.memoryUsage();
            global.gc();
            const after = process.memoryUsage();

            logger.debug(LogCategory.SYSTEM, 'Forced garbage collection', {
                memoryBefore: {
                    rss: Math.round(before.rss / 1024 / 1024),
                    heapUsed: Math.round(before.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(before.heapTotal / 1024 / 1024)
                },
                memoryAfter: {
                    rss: Math.round(after.rss / 1024 / 1024),
                    heapUsed: Math.round(after.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(after.heapTotal / 1024 / 1024)
                },
                freedMB: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024)
            });
        } else {
            logger.debug(LogCategory.SYSTEM, 'Garbage collection not available (use --expose-gc flag)');
        }
    }

    /**
     * Get current memory usage
     */
    static getMemoryUsage(): {
        rss: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
        arrayBuffers: number;
    } {
        const usage = process.memoryUsage();
        return {
            rss: Math.round(usage.rss / 1024 / 1024),
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
            external: Math.round(usage.external / 1024 / 1024),
            arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024)
        };
    }

    /**
     * Log memory usage with context
     */
    static logMemoryUsage(context: string): void {
        const usage = this.getMemoryUsage();
        logger.debug(LogCategory.SYSTEM, 'Memory usage', {
            context,
            ...usage
        });
    }
}
