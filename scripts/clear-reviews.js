const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;
const USERS_TABLE = `pickyourcourses-${STAGE}-users`;
const VOTES_TABLE = `pickyourcourses-${STAGE}-votes`;

async function clearReviews() {
  console.log("Clearing all reviews from the database...\n");

  try {
    // First, get all reviews
    console.log("Scanning reviews table...");
    const reviewsResult = await dynamodb
      .scan({
        TableName: REVIEWS_TABLE,
      })
      .promise();

    if (reviewsResult.Items && reviewsResult.Items.length > 0) {
      console.log(`Found ${reviewsResult.Items.length} reviews to delete`);

      // Delete reviews in batches
      const batchSize = 25; // DynamoDB batch write limit
      for (let i = 0; i < reviewsResult.Items.length; i += batchSize) {
        const batch = reviewsResult.Items.slice(i, i + batchSize);
        const deleteRequests = batch.map((item) => ({
          DeleteRequest: {
            Key: { reviewId: item.reviewId },
          },
        }));

        await dynamodb
          .batchWrite({
            RequestItems: {
              [REVIEWS_TABLE]: deleteRequests,
            },
          })
          .promise();

        console.log(`Deleted batch ${Math.floor(i / batchSize) + 1}`);
      }
    } else {
      console.log("No reviews found to delete");
    }

    // Clear votes
    console.log("\nScanning votes table...");
    const votesResult = await dynamodb
      .scan({
        TableName: VOTES_TABLE,
      })
      .promise();

    if (votesResult.Items && votesResult.Items.length > 0) {
      console.log(`Found ${votesResult.Items.length} votes to delete`);

      // Delete votes in batches
      const batchSize = 25;
      for (let i = 0; i < votesResult.Items.length; i += batchSize) {
        const batch = votesResult.Items.slice(i, i + batchSize);
        const deleteRequests = batch.map((item) => ({
          DeleteRequest: {
            Key: { voteId: item.voteId },
          },
        }));

        await dynamodb
          .batchWrite({
            RequestItems: {
              [VOTES_TABLE]: deleteRequests,
            },
          })
          .promise();

        console.log(`Deleted votes batch ${Math.floor(i / batchSize) + 1}`);
      }
    } else {
      console.log("No votes found to delete");
    }

    // Clear users (optional - only clear users created for reviews)
    console.log("\nScanning users table...");
    const usersResult = await dynamodb
      .scan({
        TableName: USERS_TABLE,
      })
      .promise();

    if (usersResult.Items && usersResult.Items.length > 0) {
      // Only delete users that were created for reviews (have displayName or start with reviewer_)
      const reviewUsers = usersResult.Items.filter(
        (user) =>
          user.displayName || 
          user.telegramId.startsWith("reviewer_") || 
          user.telegramId.startsWith("anon_user")
      );

      if (reviewUsers.length > 0) {
        console.log(`Found ${reviewUsers.length} review users to delete`);

        // Delete users in batches
        const batchSize = 25;
        for (let i = 0; i < reviewUsers.length; i += batchSize) {
          const batch = reviewUsers.slice(i, i + batchSize);
          const deleteRequests = batch.map((item) => ({
            DeleteRequest: {
              Key: { telegramId: item.telegramId },
            },
          }));

          await dynamodb
            .batchWrite({
              RequestItems: {
                [USERS_TABLE]: deleteRequests,
              },
            })
            .promise();

          console.log(`Deleted users batch ${Math.floor(i / batchSize) + 1}`);
        }
      } else {
        console.log("No review users found to delete");
      }
    }

    console.log("\n✅ Database cleared successfully!");
    console.log("You can now run 'node scripts/load-reviews.js' to reload the updated reviews.");

  } catch (error) {
    console.error("❌ Error clearing database:", error);
    process.exit(1);
  }
}

clearReviews().catch(console.error);