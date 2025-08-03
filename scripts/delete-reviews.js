const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;
const USERS_TABLE = `pickyourcourses-${STAGE}-users`;
const VOTES_TABLE = `pickyourcourses-${STAGE}-votes`;

/**
 * Delete reviews based on search criteria
 * @param {Object} searchCriteria - Criteria to find reviews to delete
 * @param {Object} options - Additional options
 */
async function deleteReviews(searchCriteria, options = {}) {
  console.log("Deleting reviews based on search criteria...\n");

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

    if (searchCriteria.reviewIds && Array.isArray(searchCriteria.reviewIds)) {
      const reviewIdConditions = searchCriteria.reviewIds.map((_, index) => {
        const key = `:reviewId${index}`;
        expressionAttributeValues[key] = searchCriteria.reviewIds[index];
        return `reviewId = ${key}`;
      });
      filterExpressions.push(`(${reviewIdConditions.join(" OR ")})`);
    }

    if (filterExpressions.length > 0) {
      scanParams.FilterExpression = filterExpressions.join(" AND ");
      if (Object.keys(expressionAttributeNames).length > 0) {
        scanParams.ExpressionAttributeNames = expressionAttributeNames;
      }
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

    let deletedCount = 0;
    let skippedCount = 0;

    for (const review of result.Items) {
      const user = userMap.get(review.userId);
      const userName = user?.displayName || user?.name || "Unknown";

      console.log(`\nProcessing review by: ${userName}`);
      console.log(`  Course: ${review.courseId}`);
      console.log(`  Review ID: ${review.reviewId}`);
      console.log(`  Text: ${review.text?.substring(0, 100)}...`);

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

      if (!options.dryRun) {
        // Delete associated votes first
        try {
          const votesResult = await dynamodb.scan({
            TableName: VOTES_TABLE,
            FilterExpression: "reviewId = :reviewId",
            ExpressionAttributeValues: { ":reviewId": review.reviewId }
          }).promise();

          if (votesResult.Items && votesResult.Items.length > 0) {
            console.log(`  → Deleting ${votesResult.Items.length} associated votes`);
            for (const vote of votesResult.Items) {
              await dynamodb.delete({
                TableName: VOTES_TABLE,
                Key: { voteId: vote.voteId }
              }).promise();
            }
          }
        } catch (voteError) {
          console.log(`  ⚠ Warning: Could not delete votes: ${voteError.message}`);
        }

        // Delete the review
        await dynamodb.delete({
          TableName: REVIEWS_TABLE,
          Key: { reviewId: review.reviewId }
        }).promise();

        console.log(`  ✓ Deleted successfully`);
      } else {
        console.log(`  ✓ Would delete (dry run)`);
      }

      deletedCount++;
    }

    console.log(`\n✅ Deletion completed!`);
    console.log(`   Deleted: ${deletedCount} reviews`);
    console.log(`   Skipped: ${skippedCount} reviews`);

    // Get updated total count
    if (!options.dryRun) {
      try {
        const totalResult = await dynamodb
          .scan({
            TableName: REVIEWS_TABLE,
            Select: "COUNT",
          })
          .promise();

        console.log(`📊 Total reviews remaining in database: ${totalResult.Count}`);
      } catch (error) {
        console.error("Error getting total count:", error.message);
      }
    }

  } catch (error) {
    console.error("❌ Error deleting reviews:", error);
    process.exit(1);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node delete-reviews.js [config-file.json]

Example config file format:
{
  "searchCriteria": {
    "courseId": "MAA251",
    "reviewerName": "Martin Lau",
    "textContains": "redoing semester 3 content",
    "anonymous": false,
    "reviewId": "specific-review-id",
    "reviewIds": ["review1", "review2", "review3"]
  },
  "options": {
    "dryRun": false,
    "exclude": [
      { "reviewerName": "Important Reviewer" },
      { "reviewId": "review-to-keep" }
    ]
  }
}

Or modify this script to include your deletion configuration directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  const configFile = args[0];
  
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const { searchCriteria, options } = config;
    
    if (!searchCriteria) {
      console.error("Config file must contain 'searchCriteria' object");
      process.exit(1);
    }
    
    deleteReviews(searchCriteria, options || {}).catch(console.error);
  } catch (error) {
    console.error("Error reading config file:", error.message);
    process.exit(1);
  }
}

module.exports = { deleteReviews };