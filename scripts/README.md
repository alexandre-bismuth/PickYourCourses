# Database Management Scripts

This directory contains 7 core scripts for managing the PickYourCourses database, plus deployment and monitoring utilities.

## Core Database Scripts

### 1. Clear Reviews Database
**File:** `clear-reviews.js`
**Purpose:** Completely clears all reviews, votes, and associated users from the database.

```bash
node scripts/clear-reviews.js
```

### 2. Add Reviews
**File:** `add-reviews.js`
**Purpose:** Add a list of reviews without modifying the rest of the database.

```bash
# Using a JSON file
node scripts/add-reviews.js reviews-data.json

# Example reviews-data.json format:
[
  {
    "courseId": "CSE101",
    "reviewerName": "John Doe",
    "ratings": { "overall": 4, "quality": 4, "difficulty": 3 },
    "text": "Great course!",
    "anonymous": false
  }
]
```

### 3. Update Review Fields
**File:** `update-review.js`
**Purpose:** Change any field of existing reviews based on search criteria.

```bash
node scripts/update-review.js config.json

# Example config.json:
{
  "searchCriteria": {
    "courseId": "CHE201",
    "reviewerName": "John Doe"
  },
  "updates": {
    "courseId": "CHE101",
    "anonymous": true
  },
  "options": {
    "dryRun": false,
    "exclude": [{"reviewerName": "Important User"}]
  }
}
```

### 4. Delete Reviews
**File:** `delete-reviews.js`
**Purpose:** Delete a given set of reviews without modifying the rest of the database.

```bash
node scripts/delete-reviews.js config.json

# Example config.json:
{
  "searchCriteria": {
    "courseId": "MAA251",
    "textContains": "specific text"
  },
  "options": {
    "dryRun": false
  }
}
```

### 5. Add Courses
**File:** `add-courses.js`
**Purpose:** Add a list of courses to the database.

```bash
node scripts/add-courses.js courses-data.json [--overwrite]

# Example courses-data.json:
[
  {
    "courseId": "CSE101",
    "category": "CSE",
    "name": "Introduction to Computer Programming",
    "description": "Basic programming concepts",
    "gradingScheme": {
      "description": "Final exam 60%, Projects 40%",
      "lastModified": "2024-01-01T00:00:00Z",
      "modifiedBy": "admin"
    }
  }
]
```

### 6. Remove Courses
**File:** `remove-courses.js`
**Purpose:** Remove a list of courses from the database.

```bash
node scripts/remove-courses.js config.json [--dry-run] [--force] [--delete-reviews]

# Example config.json (simple):
["CSE101", "CSE102", "CSE103"]

# Example config.json (advanced):
{
  "searchCriteria": {
    "category": "CSE",
    "courseIds": ["CSE101", "CSE102"]
  },
  "options": {
    "force": false,
    "deleteReviews": false
  }
}
```

### 7. Update Course Grading
**File:** `update-course-grading.js`
**Purpose:** Update the grading scheme of given courses.

```bash
node scripts/update-course-grading.js config.json [--dry-run] [--modified-by admin]

# Example config.json:
[
  {
    "courseId": "CSE101",
    "gradingScheme": "Final exam 60%, Projects 30%, Participation 10%",
    "modifiedBy": "admin"
  }
]
```

## Deployment & Monitoring Scripts

- **`deploy.sh`** - Deployment script
- **`rollback.sh`** - Rollback deployments
- **`monitor.sh`** - Monitor system health

## Utilities

The `utils/` folder contains verification and debugging scripts:
- `verify-*.js` - Various verification scripts for checking database state

## Common Options

Most scripts support these common options:
- `--dry-run` - Show what would be done without actually doing it
- `--force` - Force operations even when warnings are present
- `--verbose` - Enable verbose output

## Environment Variables

All scripts use these environment variables:
- `AWS_REGION` - AWS region (default: us-east-1)
- `STAGE` - Deployment stage (default: dev)

## Safety Features

- **Dry run mode**: Most scripts support `--dry-run` to preview changes
- **Exclusion lists**: Protect specific records from bulk operations
- **Confirmation prompts**: Critical operations require confirmation
- **Rollback capability**: Database changes can be reverted using rollback scripts

## Examples

### Load initial course data
```bash
node scripts/add-courses.js data/courses.json --overwrite
```

### Add chemistry reviews
```bash
node scripts/add-reviews.js data/chemistry-reviews.json
```

### Fix course assignments (move reviews from CHE201 to CHE101)
```bash
node scripts/update-review.js configs/fix-chemistry.json
```

### Remove deprecated courses
```bash
node scripts/remove-courses.js configs/deprecated-courses.json --delete-reviews
```

### Update grading schemes
```bash
node scripts/update-course-grading.js configs/new-grading.json --modified-by admin
```