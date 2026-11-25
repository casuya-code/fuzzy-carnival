# Security Policy

## Reporting

Please report security vulnerabilities privately to the maintainers. Do not open public issues for sensitive reports.

## Deployment guidance

- Set `API_KEY` and require it for all expensive/mutating endpoints.
- Set `ALLOWED_ORIGINS` to explicit trusted origins. Avoid wildcard Vercel origins with credentials unless you fully understand the risk.
- Set `EXPOSE_HEALTH_DETAILS=false` on public deployments.
- Configure upload limits (`MAX_UPLOAD_MB`) and object storage lifecycle policies.
- If R2 is not configured, understand that local `/static` serving is a development fallback; do not expose it publicly without auth and isolation.
- Rotate API/provider keys regularly and use least-privilege credentials.

## Known limitations

- In-memory rate limiting is process-local and best-effort.
- Process-local synthesis/reference caches are not shared across workers.
- Uploaded/generated media should be treated as untrusted input; use sandboxing, quotas, and malware/media scanning in production.
