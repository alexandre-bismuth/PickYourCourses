#!/bin/bash

# AWS Lambda Deployment Script for PickYourCourses Bot
# Usage: ./scripts/deploy.sh [dev|staging|prod] [options]

set -e

# Configuration
PROJECT_NAME="pickyourcourses"
AWS_REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
AWS Lambda Deployment Script for PickYourCourses Bot

Usage: $0 [STAGE] [OPTIONS]

STAGES:
    dev         Deploy to development environment
    staging     Deploy to staging environment
    prod        Deploy to production environment

OPTIONS:
    --help, -h          Show this help message
    --dry-run          Show what would be deployed without actually deploying
    --verbose, -v      Enable verbose output
    --skip-tests       Skip running tests before deployment
    --force            Force deployment even if validation fails
    --package-only     Only create deployment package, don't deploy

EXAMPLES:
    $0 dev                          # Deploy to development
    $0 prod --verbose              # Deploy to production with verbose output
    $0 staging --dry-run           # Show what would be deployed to staging
    $0 dev --skip-tests --force    # Force deploy to dev without tests

ENVIRONMENT VARIABLES:
    AWS_REGION                     AWS region (default: us-east-1)
    TELEGRAM_BOT_TOKEN            Telegram bot token (required)
    SOURCE_EMAIL                  SES source email address
    WEBHOOK_SECRET                Webhook secret token

EOF
}

# Parse command line arguments
STAGE=""
DRY_RUN=false
VERBOSE=false
SKIP_TESTS=false
FORCE=false
PACKAGE_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        dev|staging|prod)
            STAGE="$1"
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --package-only)
            PACKAGE_ONLY=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate stage
if [[ -z "$STAGE" ]]; then
    log_error "Stage is required. Use 'dev', 'staging', or 'prod'"
    show_help
    exit 1
fi

# Set verbose output if requested
if [[ "$VERBOSE" == true ]]; then
    set -x
fi

log_info "Starting deployment for stage: $STAGE"

# Change to project directory
cd "$PROJECT_ROOT"

# Load environment variables from .env file if it exists
if [[ -f ".env" ]]; then
    log_info "Loading environment variables from .env file..."
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
fi

# Validate environment
log_info "Validating environment..."

# Check required tools
command -v npm >/dev/null 2>&1 || { log_error "npm is required but not installed"; exit 1; }
command -v aws >/dev/null 2>&1 || { log_error "AWS CLI is required but not installed"; exit 1; }

# Check AWS credentials
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid"
    exit 1
fi

# Validate required environment variables
if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    log_error "TELEGRAM_BOT_TOKEN environment variable is required"
    exit 1
fi

log_success "Environment validation passed"

# Install dependencies
log_info "Installing dependencies..."
npm ci

# Run tests (unless skipped)
if [[ "$SKIP_TESTS" != true ]]; then
    log_info "Running tests..."
    if ! npm test; then
        if [[ "$FORCE" != true ]]; then
            log_error "Tests failed. Use --force to deploy anyway or --skip-tests to skip tests"
            exit 1
        else
            log_warning "Tests failed but deployment will continue due to --force flag"
        fi
    fi
    log_success "Tests passed"
else
    log_warning "Tests skipped"
fi

# Build the project
log_info "Building project..."
npm run build
log_success "Build completed"

# Package the application
log_info "Creating deployment package..."
if [[ "$DRY_RUN" == true ]]; then
    log_info "DRY RUN: Would run: npm run package"
else
    npm run package
fi
log_success "Deployment package created"

# Exit early if package-only
if [[ "$PACKAGE_ONLY" == true ]]; then
    log_success "Package-only mode: Deployment package created successfully"
    exit 0
fi

# Deploy with Serverless Framework
log_info "Deploying to AWS Lambda..."

DEPLOY_COMMAND="npx serverless deploy --stage $STAGE --region $AWS_REGION"

if [[ "$VERBOSE" == true ]]; then
    DEPLOY_COMMAND="$DEPLOY_COMMAND --verbose"
fi

if [[ "$DRY_RUN" == true ]]; then
    log_info "DRY RUN: Would run: $DEPLOY_COMMAND"
    log_info "DRY RUN: Deployment configuration:"
    npx serverless print --stage "$STAGE" --region "$AWS_REGION"
else
    log_info "Running: $DEPLOY_COMMAND"
    eval "$DEPLOY_COMMAND"
    
    # Get deployment info
    log_info "Getting deployment information..."
    WEBHOOK_URL=$(npx serverless info --stage "$STAGE" --region "$AWS_REGION" | grep "webhook:" | awk '{print $2}')
    HEALTH_CHECK_URL=$(npx serverless info --stage "$STAGE" --region "$AWS_REGION" | grep "health:" | awk '{print $2}')
    
    log_success "Deployment completed successfully!"
    log_info "Deployment Information:"
    echo "  Stage: $STAGE"
    echo "  Region: $AWS_REGION"
    echo "  Webhook URL: $WEBHOOK_URL"
    echo "  Health Check URL: $HEALTH_CHECK_URL"
fi

# Post-deployment validation
if [[ "$DRY_RUN" != true ]]; then
    log_info "Running post-deployment validation..."
    
    # Test health check endpoint
    if [[ -n "$HEALTH_CHECK_URL" ]]; then
        log_info "Testing health check endpoint..."
        if curl -f -s "$HEALTH_CHECK_URL" > /dev/null; then
            log_success "Health check endpoint is responding"
        else
            log_warning "Health check endpoint is not responding"
        fi
    fi
    
    # Validate Lambda function
    FUNCTION_NAME="$PROJECT_NAME-$STAGE-webhook"
    if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
        log_success "Lambda function is deployed and accessible"
        
        # Get function configuration
        log_info "Lambda function configuration:"
        aws lambda get-function-configuration --function-name "$FUNCTION_NAME" --region "$AWS_REGION" \
            --query '{Runtime:Runtime,MemorySize:MemorySize,Timeout:Timeout,LastModified:LastModified}' \
            --output table
    else
        log_error "Lambda function validation failed"
        exit 1
    fi
fi

# Show next steps
log_info "Next Steps:"
echo "1. Set the webhook URL in your Telegram bot:"
echo "   curl -X POST \"https://api.telegram.org/bot\$TELEGRAM_BOT_TOKEN/setWebhook\" \\"
echo "        -H \"Content-Type: application/json\" \\"
echo "        -d '{\"url\": \"$WEBHOOK_URL\"}'"
echo ""
echo "2. Test the bot by sending a message"
echo ""
echo "3. Monitor logs with:"
echo "   npm run logs:$STAGE"
echo ""
echo "4. Monitor health with:"
echo "   curl $HEALTH_CHECK_URL"

log_success "Deployment script completed successfully!"
