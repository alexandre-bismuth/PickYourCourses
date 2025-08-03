const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;
const USERS_TABLE = `pickyourcourses-${STAGE}-users`;

/**
 * Update review fields based on search criteria
 * @param {Object} searchCriteria - Criteria to find reviews to update
 * @param {Object} updates - Fields to update
 * @param {Object} options - Additional options
 */
async function updateReviews(searchCriteria, updates, options = {}) {
  console.log("Updating reviews based on search criteria...\n");

  try {
    // Build scan parameters based on search criteria
    const scanParams = {
      TableName: REVIEWS_TABLE,
    };

    // Build filter expression
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (searchCriteria.courseId) {
      filterExpressions.push("courseId = :courseId");
      expressionAttributeValues[":courseId"] = searchCriteria.courseId;
    }

    if (searchCriteria.reviewerName) {
      // Need to get user ID first
      const userId = `reviewer_${searchCriteria.reviewerName
        .replace(/\s+/g, "_")
        .toLowerCase()}`;
      filterExpressions.push("userId = :userId");
      expressionAttributeValues[":userId"] = userId;
    }

    if (searchCriteria.textContains) {
      filterExpressions.push("contains(#text, :textContent)");
      expressionAttributeNames["#text"] = "text";
      expressionAttributeValues[":textContent"] = searchCriteria.textContains;
    }

    if (searchCriteria.anonymous !== undefined) {
      filterExpressions.push("anonymous = :anonymous");
      expressionAttributeValues[":anonymous"] = searchCriteria.anonymous;
    }

    if (searchCriteria.reviewId) {
      filterExpressions.push("reviewId = :reviewId");
      expressionAttributeValues[":reviewId"] = searchCriteria.reviewId;
    }

    if (filterExpressions.length > 0) {
      scanParams.FilterExpression = filterExpressions.join(" AND ");
      scanParams.ExpressionAttributeNames = expressionAttributeNames;
      scanParams.ExpressionAttributeValues = expressionAttributeValues;
    }

    console.log("Scanning for matching reviews...");
    const result = await dynamodb.scan(scanParams).promise();

    if (!result.Items || result.Items.length === 0) {
      console.log("No matching reviews found.");
      return;
    }

    console.log(`Found ${result.Items.length} matching review(s)`);

    // Get user information for display
    const usersResult = await dynamodb.scan({ TableName: USERS_TABLE }).promise();
    const userMap = new Map();
    usersResult.Items?.forEach((user) => {
      userMap.set(user.telegramId, user);
    });

    let updatedCount = 0;
    let skippedCount = 0;

    for (const review of result.Items) {
      const user = userMap.get(review.userId);
      const userName = user?.displayName || user?.name || "Unknown";

      console.log(`\nProcessing review by: ${userName}`);
      console.log(`  Course: ${review.courseId}`);
      console.log(`  Review ID: ${review.reviewId}`);

      // Check if this review should be excluded
      if (options.exclude && options.exclude.some(excludeRule => {
        if (excludeRule.reviewerName && userName === excludeRule.reviewerName) return true;
        if (excludeRule.reviewId && review.reviewId === excludeRule.reviewId) return true;
        return false;
      })) {
        console.log(`  ✓ Skipped (excluded)`);
        skippedCount++;
        continue;
      }

      // Build update expression
      const updateExpressions = [];
      const updateAttributeNames = {};
      const updateAttributeValues = {};

      if (updates.courseId) {
        updateExpressions.push("courseId = :newCourseId");
        updateAttributeValues[":newCourseId"] = updates.courseId;
      }

      if (updates.ratings) {
        updateExpressions.push("ratings = :newRatings");
        updateAttributeValues[":newRatings"] = updates.ratings;
      }

      if (updates.text !== undefined) {
        updateExpressions.push("#text = :newText");
        updateAttributeNames["#text"] = "text";
        updateAttributeValues[":newText"] = updates.text;
      }

      if (updates.anonymous !== undefined) {
        updateExpressions.push("anonymous = :newAnonymous");
        updateAttributeValues[":newAnonymous"] = updates.anonymous;
      }

      // Always update the updatedAt timestamp
      updateExpressions.push("updatedAt = :updatedAt");
      updateAttributeValues[":updatedAt"] = new Date().toISOString();

      if (updateExpressions.length === 1) { // Only updatedAt
        console.log(`  ✓ No updates specified`);
        skippedCount++;
        continue;
      }

      // Perform the update
      const updateParams = {
        TableName: REVIEWS_TABLE,
        Key: { reviewId: review.reviewId },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: Object.keys(updateAttributeNames).length > 0 ? updateAttributeNames : undefined,
        ExpressionAttributeValues: updateAttributeValues,
      };

      if (!options.dryRun) {
        await dynamodb.update(updateParams).promise();
        console.log(`  ✓ Updated successfully`);
      } else {
        console.log(`  ✓ Would update (dry run)`);
      }

      updatedCount++;
    }

    console.log(`\n✅ Update completed!`);
    console.log(`   Updated: ${updatedCount} reviews`);
    console.log(`   Skipped: ${skippedCount} reviews`);

  } catch (error) {
    console.error("❌ Error updating reviews:", error);
    process.exit(1);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node update-review.js [config-file.json]

Example config file format:
{
  "searchCriteria": {
    "courseId": "CHE201",
    "reviewerName": "John Doe",
    "textContains": "specific text",
    "anonymous": false,
    "reviewId": "specific-review-id"
  },
  "updates": {
    "courseId": "CHE101",
    "ratings": { "overall": 4, "quality": 4, "difficulty": 3 },
    "text": "Updated review text",
    "anonymous": true
  },
  "options": {
    "dryRun": false,
    "exclude": [
      { "reviewerName": "Ines Benbrahim" },
      { "reviewId": "specific-review-to-exclude" }
    ]
  }
}

Or modify this script to include your update configuration directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  const configFile = args[0];
  
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const { searchCriteria, updates, options } = config;
    
    if (!searchCriteria || !updates) {
      console.error("Config file must contain 'searchCriteria' and 'updates' objects");
      process.exit(1);
    }
    
    updateReviews(searchCriteria, updates, options || {}).catch(console.error);
  } catch (error) {
    console.error("Error reading config file:", error.message);
    process.exit(1);
  }
}

module.exports = { updateReviews };