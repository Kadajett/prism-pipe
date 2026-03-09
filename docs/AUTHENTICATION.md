# Authentication & Rate Limiting

## Authentication

The gateway supports API key authentication via HTTP headers. When disabled, the proxy operates in "open proxy mode" (useful for local development).

### Configuration

```yaml
# prism-pipe.yaml
auth:
  enabled: true
  apiKey: "your-secret-key-here"
```

### Sending Authenticated Requests

Two header formats are supported:

**Bearer token (recommended):**
```bash
curl https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

**API key header:**
```bash
curl https://api.example.com/v1/chat/completions \
  -H "x-api-key: your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

### Response Codes

- **200 OK** - Request authenticated successfully
- **401 Unauthorized** - Missing or invalid API key

**Error response format:**
```json
{
  "error": {
    "type": "authentication_error",
    "message": "Invalid API key"
  }
}
```

### Open Proxy Mode

When auth is disabled or no API key is configured, all requests are allowed through:

```yaml
auth:
  enabled: false
```

This is useful for:
- Local development
- Internal-only deployments
- Testing

---

## Rate Limiting

Token bucket rate limiting prevents abuse and ensures fair usage across clients.

### Configuration

```yaml
rateLimit:
  enabled: true
  capacity: 60        # Maximum burst (tokens in bucket)
  refillRate: 1       # Tokens added per second
```

**Example configurations:**

```yaml
# 60 requests per minute (1 req/sec, burst of 60)
rateLimit:
  enabled: true
  capacity: 60
  refillRate: 1

# 100 requests per minute (1.67 req/sec, burst of 100)
rateLimit:
  enabled: true
  capacity: 100
  refillRate: 1.67

# Strict 1 req/sec (no burst)
rateLimit:
  enabled: true
  capacity: 1
  refillRate: 1
```

### Rate Limit Scopes

Limits are enforced per:
1. **API key** (if auth is enabled and key is provided)
2. **IP address** (fallback when no API key)

Different clients are tracked independently.

### Response Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1709912400
```

- `X-RateLimit-Limit` - Maximum capacity
- `X-RateLimit-Remaining` - Tokens left in bucket
- `X-RateLimit-Reset` - Unix timestamp when bucket fully refills

### Rate Limit Exceeded

When the bucket is empty, requests return **429 Too Many Requests**:

```json
{
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded",
    "retryAfter": 1.5
  }
}
```

The `Retry-After` header tells the client how many seconds to wait:

```
Retry-After: 2
```

### How Token Bucket Works

1. **Burst traffic** - Bucket starts full. Requests consume 1 token each. Up to `capacity` requests can be made instantly.
2. **Refill** - Tokens are added at `refillRate` per second.
3. **Limit** - Bucket never exceeds `capacity`.

**Example:**
- Capacity: 10, Refill: 1/sec
- 10 instant requests → bucket empty
- Wait 3 seconds → 3 tokens added
- 3 more requests succeed → bucket empty again
- Wait 10 seconds → bucket fully refills to 10

This allows occasional bursts while maintaining an average rate.

### Disabling Rate Limiting

```yaml
rateLimit:
  enabled: false
```

Rate limit headers are still sent, but all requests are allowed through.

---

## Best Practices

1. **Separate keys for different environments**
   ```yaml
   auth:
     apiKey: ${API_KEY}  # Load from environment variable
   ```

2. **Monitor rate limit headers**
   Check `X-RateLimit-Remaining` and back off before hitting 429s

3. **Handle 429 responses**
   Respect `Retry-After` header and implement exponential backoff

4. **Use burst capacity wisely**
   Set `capacity` high enough for legitimate bursts, but not so high that abuse can spike

5. **Adjust refill rate for your use case**
   - Interactive apps: Higher refill rate for responsiveness
   - Batch jobs: Lower refill rate, rely on capacity for bursts
