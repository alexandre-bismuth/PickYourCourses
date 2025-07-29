#!/bin/bash

# AWS Lambda Rollback Script for PickYourCourses Bot
# Usage: ./scripts/rollback.sh [dev|staging|prod] [options]

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
AWS Lambda Rollback Script for PickYourCourses Bot

Usage: $0 [STAGE] [OPTIONS]

STAGES:
    dev         Rollback development environment
    staging     Rollback staging environment
    prod        Rollback production environment

OPTIONS:
    --help, -h          Show this help message
    --list-versions     List available versions for rollback
    --version VERSION   Rollback to specific version
    --previous          Rollback to previous version (default)
    --dry-run          Show what would be rolled back without actually doing it
    --verbose, -v      Enable verbose output
    --force            Force rollback even if validation fails

EXAMPLES:
    $0 dev                          # Rollback dev to previous version
    $0 prod --version 3            # Rollback prod to version 3
    $0 staging --list-versions     # List available versions for staging
    $0 dev --dry-run               # Show what would be rolled back

EOF
}

# Parse command line arguments
STAGE=""
DRY_RUN=false
VERBOSE=false
FORCE=false
LIST_VERSIONS=false
TARGET_VERSION=""
ROLLBACK_TO_PREVIOUS=true

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
        --list-versions)
            LIST_VERSIONS=true
            shift
            ;;
        --version)
            TARGET_VERSION="$2"
            ROLLBACK_TO_PREVIOUS=false
            shift 2
            ;;
        --previous)
            ROLLBACK_TO_PREVIOUS=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --force)
            FORCE=true
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

log_info "Starting rollback process for stage: $STAGE"

# Change to project directory
cd "$PROJECT_ROOT"

# Check required tools
command -v aws >/dev/null 2>&1 || { log_error "AWS CLI is required but not installed"; exit 1; }
command -v npx >/dev/null 2>&1 || { log_error "npx is required but not installed"; exit 1; }

# Check AWS credentials
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid"
    exit 1
fi

# Function names
WEBHOOK_FUNCTION="$PROJECT_NAME-$STAGE-webhook"
HEALTH_FUNCTION="$PROJECT_NAME-$STAGE-health"

# List versions if requested
if [[ "$LIST_VERSIONS" == true ]]; then
    log_info "Available versions for $WEBHOOK_FUNCTION:"
    aws lambda list-versions-by-function \
        --function-name "$WEBHOOK_FUNCTION" \
        --region "$AWS_REGION" \
        --query 'Versions[?Version!=`$LATEST`].{Version:Version,LastModified:LastModified,Description:Description}' \
        --output table
    
    log_info "Available versions for $HEALTH_FUNCTION:"
    aws lambda list-versions-by-function \
        --function-name "$HEALTH_FUNCTION" \
        --region "$AWS_REGION" \
        --query 'Versions[?Version!=`$LATEST`].{Version:Version,LastModified:LastModified,Description:Description}' \
        --output table
    
    exit 0
fi

# Get current version
get_current_version() {
    local function_name=$1
    aws lambda get-function \
        --function-name "$function_name" \
        --region "$AWS_REGION" \
        --query 'Configuration.Version' \
        --output text
}

# Get available versions
get_available_versions() {
    local function_name=$1
    aws lambda list-versions-by-function \
        --function-name "$function_name" \
        --region "$AWS_REGION" \
        --query 'Versions[?Version!=`$LATEST`].Version' \
        --output text | tr '\t' '\n' | sort -nr
}

# Validate function exists
validate_function() {
    local function_name=$1
    if ! aws lambda get-function --function-name "$function_name" --region "$AWS_REGION" >/dev/null 2>&1; then
        log_error "Function $function_name does not exist"
        return 1
    fi
    return 0
}

# Validate functions exist
log_info "Validating Lambda functions..."
if ! validate_function "$WEBHOOK_FUNCTION"; then
    exit 1
fi

if ! validate_function "$HEALTH_FUNCTION"; then
    exit 1
fi

log_success "Function validation passed"

# Get current versions
CURRENT_WEBHOOK_VERSION=$(get_current_version "$WEBHOOK_FUNCTION")
CURRENT_HEALTH_VERSION=$(get_current_version "$HEALTH_FUNCTION")

log_info "Current versions:"
echo "  Webhook: $CURRENT_WEBHOOK_VERSION"
echo "  Health: $CURRENT_HEALTH_VERSION"

# Determine target version
if [[ "$ROLLBACK_TO_PREVIOUS" == true ]]; then
    log_info "Finding previous version..."
    
    # Get available versions (sorted newest first)
    AVAILABLE_VERSIONS=($(get_available_versions "$WEBHOOK_FUNCTION"))
    
    if [[ ${#AVAILABLE_VERSIONS[@]} -lt 2 ]]; then
        log_error "Not enough versions available for rollback. Need at least 2 versions."
        exit 1
    fi
    
    # Find the version before current
    TARGET_VERSION=""
    for version in "${AVAILABLE_VERSIONS[@]}"; do
        if [[ "$version" != "$CURRENT_WEBHOOK_VERSION" ]]; then
            TARGET_VERSION="$version"
            break
        fi
    done
    
    if [[ -z "$TARGET_VERSION" ]]; then
        log_error "Could not determine previous version"
        exit 1
    fi
    
    log_info "Previous version identified: $TARGET_VERSION"
else
    log_info "Target version specified: $TARGET_VERSION"
    
    # Validate target version exists
    AVAILABLE_VERSIONS=($(get_available_versions "$WEBHOOK_FUNCTION"))
    VERSION_EXISTS=false
    
    for version in "${AVAILABLE_VERSIONS[@]}"; do
        if [[ "$version" == "$TARGET_VERSION" ]]; then
            VERSION_EXISTS=true
            break
        fi
    done
    
    if [[ "$VERSION_EXISTS" != true ]]; then
        log_error "Target version $TARGET_VERSION does not exist"
        log_info "Available versions: ${AVAILABLE_VERSIONS[*]}"
        exit 1
    fi
fi

# Confirm rollback
if [[ "$FORCE" != true ]] && [[ "$DRY_RUN" != true ]]; then
    echo ""
    log_warning "ROLLBACK CONFIRMATION"
    echo "  Stage: $STAGE"
    echo "  Current Version: $CURRENT_WEBHOOK_VERSION"
    echo "  Target Version: $TARGET_VERSION"
    echo ""
    read -p "Are you sure you want to proceed with the rollback? (y/N): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Rollback cancelled by user"
        exit 0
    fi
fi

# Perform rollback
if [[ "$DRY_RUN" == true ]]; then
    log_info "DRY RUN: Would rollback functions to version $TARGET_VERSION"
    log_info "DRY RUN: Would update alias '$STAGE' to point to version $TARGET_VERSION"
else
    log_info "Rolling back to version $TARGET_VERSION..."
    
    # Update webhook function alias
    log_info "Updating webhook function alias..."
    aws lambda update-alias \
        --function-name "$WEBHOOK_FUNCTION" \
        --name "$STAGE" \
        --function-version "$TARGET_VERSION" \
        --region "$AWS_REGION" >/dev/null
    
    # Update health function alias
    log_info "Updating health function alias..."
    aws lambda update-alias \
        --function-name "$HEALTH_FUNCTION" \
        --name "$STAGE" \
        --function-version "$TARGET_VERSION" \
        --region "$AWS_REGION" >/dev/null
    
    log_success "Rollback completed successfully!"
    
    # Verify rollback
    log_info "Verifying rollback..."
    
    NEW_WEBHOOK_VERSION=$(aws lambda get-alias \
        --function-name "$WEBHOOK_FUNCTION" \
        --name "$STAGE" \
        --region "$AWS_REGION" \
        --query 'FunctionVersion' \
        --output text)
    
    NEW_HEALTH_VERSION=$(aws lambda get-alias \
        --function-name "$HEALTH_FUNCTION" \
        --name "$STAGE" \
        --region "$AWS_REGION" \
        --query 'FunctionVersion' \
        --output text)
    
    if [[ "$NEW_WEBHOOK_VERSION" == "$TARGET_VERSION" ]] && [[ "$NEW_HEALTH_VERSION" == "$TARGET_VERSION" ]]; then
        log_success "Rollback verification passed"
        log_info "New versions:"
        echo "  Webhook: $NEW_WEBHOOK_VERSION"
        echo "  Health: $NEW_HEALTH_VERSION"
    else
        log_error "Rollback verification failed"
        echo "  Expected: $TARGET_VERSION"
        echo "  Webhook: $NEW_WEBHOOK_VERSION"
        echo "  Health: $NEW_HEALTH_VERSION"
        exit 1
    fi
    
    # Test health check
    HEALTH_URL=$(npx serverless info --stage "$STAGE" --region "$AWS_REGION" | grep "health:" | awk '{print $2}')
    if [[ -n "$HEALTH_URL" ]]; then
        log_info "Testing health check endpoint..."
        if curl -f -s "$HEALTH_URL" > /dev/null; then
            log_success "Health check endpoint is responding after rollback"
        else
            log_warning "Health check endpoint is not responding"
        fi
    fi
fi

log_info "Rollback Information:"
echo "  Stage: $STAGE"
echo "  Previous Version: $CURRENT_WEBHOOK_VERSION"
echo "  Current Version: $TARGET_VERSION"
echo "  Region: $AWS_REGION"

log_success "Rollback script completed successfully!"
