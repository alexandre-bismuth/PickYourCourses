const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;
const USERS_TABLE = `pickyourcourses-${STAGE}-users`;
const COURSES_TABLE = `pickyourcourses-${STAGE}-courses`;

// Generate unique IDs
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Create or get user for review
async function createOrGetUser(reviewerName, isAnonymous = false) {
  if (isAnonymous) {
    // For anonymous reviews, create a unique anonymous user
    const userId = generateId("anon_user");
    const user = {
      telegramId: userId,
      email: `anonymous_${userId}@example.com`,
      isAnonymous: true,
      createdAt: new Date().toISOString(),
    };

    await dynamodb
      .put({
        TableName: USERS_TABLE,
        Item: user,
      })
      .promise();

    return userId;
  } else {
    // For named reviewers, use their name as identifier
    const userId = `reviewer_${reviewerName
      .replace(/\s+/g, "_")
      .toLowerCase()}`;

    try {
      // Try to get existing user
      const result = await dynamodb
        .get({
          TableName: USERS_TABLE,
          Key: { telegramId: userId },
        })
        .promise();

      if (result.Item) {
        return userId;
      }
    } catch (error) {
      // User doesn't exist, create new one
    }

    // Create new user
    const user = {
      telegramId: userId,
      email: `${reviewerName.replace(/\s+/g, ".").toLowerCase()}@example.com`,
      displayName: reviewerName,
      isAnonymous: false,
      createdAt: new Date().toISOString(),
    };

    await dynamodb
      .put({
        TableName: USERS_TABLE,
        Item: user,
      })
      .promise();

    return userId;
  }
}

/**
 * Calculate average ratings for a course based on its reviews
 */
function calculateAverageRatings(reviews) {
  if (reviews.length === 0) {
    return {
      overall: 0,
      quality: 0,
      difficulty: 0
    };
  }

  const totals = reviews.reduce((acc, review) => {
    acc.overall += review.ratings.overall;
    acc.quality += review.ratings.quality;
    acc.difficulty += review.ratings.difficulty;
    return acc;
  }, { overall: 0, quality: 0, difficulty: 0 });

  return {
    overall: Math.round((totals.overall / reviews.length) * 10) / 10,
    quality: Math.round((totals.quality / reviews.length) * 10) / 10,
    difficulty: Math.round((totals.difficulty / reviews.length) * 10) / 10
  };
}

/**
 * Update course statistics for given course IDs
 */
async function updateCourseStatistics(courseIds) {
  const uniqueCourseIds = [...new Set(courseIds)];
  
  for (const courseId of uniqueCourseIds) {
    try {
      // Get all reviews for this course
      const reviewsResult = await dynamodb.scan({
        TableName: REVIEWS_TABLE,
        FilterExpression: "courseId = :courseId AND isDeleted = :isDeleted",
        ExpressionAttributeValues: {
          ":courseId": courseId,
          ":isDeleted": false
        }
      }).promise();

      const reviews = reviewsResult.Items || [];
      const averageRatings = calculateAverageRatings(reviews);
      const reviewCount = reviews.length;

      // Update course statistics
      await dynamodb.update({
        TableName: COURSES_TABLE,
        Key: { courseId: courseId },
        UpdateExpression: "SET averageRatings = :avgRatings, reviewCount = :reviewCount",
        ExpressionAttributeValues: {
          ":avgRatings": averageRatings,
          ":reviewCount": reviewCount
        }
      }).promise();

      console.log(`  ✓ Updated stats for ${courseId}: ${reviewCount} reviews, avg ${averageRatings.overall}`);
    } catch (error) {
      console.log(`  ✗ Failed to update stats for ${courseId}: ${error.message}`);
    }
  }
}

/**
 * Add reviews to the database
 * @param {Array} reviewsData - Array of review objects with structure:
 * {
 *   courseId: string,
 *   reviewerName: string,
 *   ratings: { overall: number, quality: number, difficulty: number },
 *   text: string,
 *   anonymous: boolean
 * }
 */
async function addReviews(reviewsData) {
  console.log(`Adding ${reviewsData.length} reviews to ${REVIEWS_TABLE}...`);

  let loadedCount = 0;
  let skippedCount = 0;

  for (const reviewData of reviewsData) {
    try {
      // Validate review data
      if (!reviewData.courseId || !reviewData.reviewerName || !reviewData.ratings) {
        console.error(`✗ Invalid review data:`, reviewData);
        skippedCount++;
        continue;
      }

      // Create or get user
      const userId = await createOrGetUser(
        reviewData.reviewerName,
        reviewData.anonymous || false
      );

      // Create review
      const review = {
        reviewId: generateId("review"),
        courseId: reviewData.courseId,
        userId: userId,
        ratings: reviewData.ratings,
        text: reviewData.text || "",
        anonymous: reviewData.anonymous || false,
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
      };

      await dynamodb
        .put({
          TableName: REVIEWS_TABLE,
          Item: review,
        })
        .promise();

      console.log(
        `✓ Added review for ${reviewData.courseId} by ${
          reviewData.anonymous ? "Anonymous" : reviewData.reviewerName
        }`
      );
      loadedCount++;
    } catch (error) {
      console.error(
        `✗ Failed to add review for ${reviewData.courseId}:`,
        error.message
      );
      skippedCount++;
    }
  }

  console.log(`\nReview addition completed!`);
  console.log(`✓ Added: ${loadedCount} reviews`);
  console.log(`✗ Skipped: ${skippedCount} reviews`);

  // Update course statistics for affected courses
  if (loadedCount > 0) {
    console.log(`\nUpdating course statistics...`);
    await updateCourseStatistics(reviewsData.map(r => r.courseId));
  }

  // Get updated total count
  try {
    const totalResult = await dynamodb
      .scan({
        TableName: REVIEWS_TABLE,
        Select: "COUNT",
      })
      .promise();

    console.log(`📊 Total reviews in database: ${totalResult.Count}`);
  } catch (error) {
    console.error("Error getting total count:", error.message);
  }
}

// Example usage and command line interface
if (require.main === module) {
  // Check if reviews data is provided as command line argument (JSON file path)
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node add-reviews.js [reviews-file.json]

Example reviews file format:
[
  {
    "courseId": "CSE101",
    "reviewerName": "John Doe",
    "ratings": { "overall": 4, "quality": 4, "difficulty": 3 },
    "text": "Great course!",
    "anonymous": false
  }
]

Or modify this script to include your reviews data directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  const reviewsFile = args[0];
  
  try {
    const reviewsData = JSON.parse(fs.readFileSync(reviewsFile, 'utf8'));
    addReviews(reviewsData).catch(console.error);
  } catch (error) {
    console.error("Error reading reviews file:", error.message);
    process.exit(1);
  }
}

module.exports = { addReviews };