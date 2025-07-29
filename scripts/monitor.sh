#!/bin/bash

# AWS Lambda Monitoring Script for PickYourCourses Bot
# Usage: ./scripts/monitor.sh [dev|staging|prod] [options]

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
AWS Lambda Monitoring Script for PickYourCourses Bot

Usage: $0 [STAGE] [OPTIONS]

STAGES:
    dev         Monitor development environment
    staging     Monitor staging environment
    prod        Monitor production environment

OPTIONS:
    --help, -h          Show this help message
    --logs              Show recent logs
    --metrics           Show CloudWatch metrics
    --health            Check health status
    --errors            Show recent errors
    --performance       Show performance metrics
    --all               Show all monitoring information
    --follow            Follow logs in real-time
    --since DURATION    Show logs since duration (e.g., '1h', '30m', '1d')

EXAMPLES:
    $0 dev --logs                   # Show recent logs for dev
    $0 prod --metrics               # Show metrics for prod
    $0 staging --health             # Check health status
    $0 dev --follow                 # Follow dev logs in real-time
    $0 prod --since 2h --errors     # Show errors from last 2 hours

EOF
}

# Parse command line arguments
STAGE=""
SHOW_LOGS=false
SHOW_METRICS=false
SHOW_HEALTH=false
SHOW_ERRORS=false
SHOW_PERFORMANCE=false
SHOW_ALL=false
FOLLOW_LOGS=false
SINCE_DURATION="1h"

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
        --logs)
            SHOW_LOGS=true
            shift
            ;;
        --metrics)
            SHOW_METRICS=true
            shift
            ;;
        --health)
            SHOW_HEALTH=true
            shift
            ;;
        --errors)
            SHOW_ERRORS=true
            shift
            ;;
        --performance)
            SHOW_PERFORMANCE=true
            shift
            ;;
        --all)
            SHOW_ALL=true
            shift
            ;;
        --follow)
            FOLLOW_LOGS=true
            shift
            ;;
        --since)
            SINCE_DURATION="$2"
            shift 2
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

# If no specific monitoring options, show all
if [[ "$SHOW_LOGS" == false ]] && [[ "$SHOW_METRICS" == false ]] && [[ "$SHOW_HEALTH" == false ]] && [[ "$SHOW_ERRORS" == false ]] && [[ "$SHOW_PERFORMANCE" == false ]]; then
    SHOW_ALL=true
fi

# Set all flags if --all is specified
if [[ "$SHOW_ALL" == true ]]; then
    SHOW_LOGS=true
    SHOW_METRICS=true
    SHOW_HEALTH=true
    SHOW_ERRORS=true
    SHOW_PERFORMANCE=true
fi

log_info "Monitoring stage: $STAGE"

# Change to project directory
cd "$PROJECT_ROOT"

# Check required tools
command -v aws >/dev/null 2>&1 || { log_error "AWS CLI is required but not installed"; exit 1; }
command -v jq >/dev/null 2>&1 || { log_error "jq is required but not installed"; exit 1; }

# Check AWS credentials
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid"
    exit 1
fi

# Function names
WEBHOOK_FUNCTION="$PROJECT_NAME-$STAGE-webhook"
HEALTH_FUNCTION="$PROJECT_NAME-$STAGE-health"

# Convert duration to seconds for CloudWatch
duration_to_seconds() {
    local duration=$1
    case $duration in
        *s) echo "${duration%s}" ;;
        *m) echo $((${duration%m} * 60)) ;;
        *h) echo $((${duration%h} * 3600)) ;;
        *d) echo $((${duration%d} * 86400)) ;;
        *) echo 3600 ;; # Default to 1 hour
    esac
}

# Health check
show_health() {
    log_info "=== HEALTH STATUS ==="
    
    # Get health endpoint URL
    HEALTH_URL=$(npx serverless info --stage "$STAGE" --region "$AWS_REGION" 2>/dev/null | grep "health:" | awk '{print $2}' || echo "")
    
    if [[ -n "$HEALTH_URL" ]]; then
        log_info "Testing health endpoint: $HEALTH_URL"
        
        HEALTH_RESPONSE=$(curl -s -f "$HEALTH_URL" 2>/dev/null || echo "")
        
        if [[ -n "$HEALTH_RESPONSE" ]]; then
            echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"
            log_success "Health endpoint is responding"
        else
            log_error "Health endpoint is not responding"
        fi
    else
        log_warning "Health endpoint URL not found"
    fi
    
    # Check function status
    for func in "$WEBHOOK_FUNCTION" "$HEALTH_FUNCTION"; do
        log_info "Checking function: $func"
        
        if aws lambda get-function --function-name "$func" --region "$AWS_REGION" >/dev/null 2>&1; then
            FUNC_CONFIG=$(aws lambda get-function-configuration --function-name "$func" --region "$AWS_REGION")
            
            STATE=$(echo "$FUNC_CONFIG" | jq -r '.State')
            LAST_UPDATE_STATUS=$(echo "$FUNC_CONFIG" | jq -r '.LastUpdateStatus')
            
            echo "  State: $STATE"
            echo "  Last Update Status: $LAST_UPDATE_STATUS"
            
            if [[ "$STATE" == "Active" ]] && [[ "$LAST_UPDATE_STATUS" == "Successful" ]]; then
                log_success "Function $func is healthy"
            else
                log_warning "Function $func may have issues"
            fi
        else
            log_error "Function $func not found"
        fi
    done
    
    echo ""
}

# Show CloudWatch metrics
show_metrics() {
    log_info "=== CLOUDWATCH METRICS ==="
    
    local end_time=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local start_time=$(date -u -d "-${SINCE_DURATION}" +"%Y-%m-%dT%H:%M:%S.000Z")
    
    for func in "$WEBHOOK_FUNCTION" "$HEALTH_FUNCTION"; do
        log_info "Metrics for $func (last $SINCE_DURATION):"
        
        # Invocations
        INVOCATIONS=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/Lambda" \
            --metric-name "Invocations" \
            --dimensions Name=FunctionName,Value="$func" \
            --start-time "$start_time" \
            --end-time "$end_time" \
            --period 300 \
            --statistics Sum \
            --region "$AWS_REGION" \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")
        
        # Errors
        ERRORS=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/Lambda" \
            --metric-name "Errors" \
            --dimensions Name=FunctionName,Value="$func" \
            --start-time "$start_time" \
            --end-time "$end_time" \
            --period 300 \
            --statistics Sum \
            --region "$AWS_REGION" \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")
        
        # Duration
        DURATION=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/Lambda" \
            --metric-name "Duration" \
            --dimensions Name=FunctionName,Value="$func" \
            --start-time "$start_time" \
            --end-time "$end_time" \
            --period 300 \
            --statistics Average \
            --region "$AWS_REGION" \
            --query 'Datapoints[0].Average' \
            --output text 2>/dev/null || echo "0")
        
        echo "  Invocations: ${INVOCATIONS:-0}"
        echo "  Errors: ${ERRORS:-0}"
        echo "  Avg Duration: ${DURATION:-0} ms"
        
        if [[ "${ERRORS:-0}" != "0" ]] && [[ "${INVOCATIONS:-0}" != "0" ]]; then
            ERROR_RATE=$(echo "scale=2; ${ERRORS:-0} * 100 / ${INVOCATIONS:-0}" | bc -l 2>/dev/null || echo "0")
            echo "  Error Rate: ${ERROR_RATE}%"
        fi
        
        echo ""
    done
}

# Show logs
show_logs() {
    log_info "=== RECENT LOGS ==="
    
    for func in "$WEBHOOK_FUNCTION" "$HEALTH_FUNCTION"; do
        log_info "Logs for $func:"
        
        LOG_GROUP="/aws/lambda/$func"
        
        if [[ "$FOLLOW_LOGS" == true ]]; then
            log_info "Following logs (press Ctrl+C to stop)..."
            aws logs tail "$LOG_GROUP" --region "$AWS_REGION" --follow
        else
            aws logs tail "$LOG_GROUP" --region "$AWS_REGION" --since "$SINCE_DURATION" 2>/dev/null || log_warning "No logs found for $func"
        fi
        
        echo ""
    done
}

# Show errors
show_errors() {
    log_info "=== RECENT ERRORS ==="
    
    for func in "$WEBHOOK_FUNCTION" "$HEALTH_FUNCTION"; do
        log_info "Errors for $func:"
        
        LOG_GROUP="/aws/lambda/$func"
        
        # Filter for ERROR logs
        aws logs filter-log-events \
            --log-group-name "$LOG_GROUP" \
            --region "$AWS_REGION" \
            --start-time $(date -d "-${SINCE_DURATION}" +%s)000 \
            --filter-pattern "ERROR" \
            --query 'events[*].[timestamp,message]' \
            --output text 2>/dev/null | while IFS=$'\t' read -r timestamp message; do
            if [[ -n "$timestamp" ]]; then
                local formatted_time=$(date -d "@$((timestamp/1000))" '+%Y-%m-%d %H:%M:%S')
                echo "[$formatted_time] $message"
            fi
        done || log_info "No errors found for $func"
        
        echo ""
    done
}

# Show performance metrics
show_performance() {
    log_info "=== PERFORMANCE METRICS ==="
    
    # This would show custom performance metrics from our LambdaPerformanceMonitor
    # For now, we'll show CloudWatch insights queries if available
    
    for func in "$WEBHOOK_FUNCTION" "$HEALTH_FUNCTION"; do
        log_info "Performance data for $func:"
        
        LOG_GROUP="/aws/lambda/$func"
        
        # Query for performance metrics in logs
        aws logs filter-log-events \
            --log-group-name "$LOG_GROUP" \
            --region "$AWS_REGION" \
            --start-time $(date -d "-${SINCE_DURATION}" +%s)000 \
            --filter-pattern "performance metrics" \
            --query 'events[*].message' \
            --output text 2>/dev/null | tail -5 || log_info "No performance metrics found for $func"
        
        echo ""
    done
}

# Execute monitoring based on options
if [[ "$SHOW_HEALTH" == true ]]; then
    show_health
fi

if [[ "$SHOW_METRICS" == true ]]; then
    show_metrics
fi

if [[ "$SHOW_ERRORS" == true ]]; then
    show_errors
fi

if [[ "$SHOW_PERFORMANCE" == true ]]; then
    show_performance
fi

if [[ "$SHOW_LOGS" == true ]]; then
    show_logs
fi

log_success "Monitoring completed for stage: $STAGE"
