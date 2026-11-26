# Security Policy

## Reporting

Please report security vulnerabilities privately to the maintainers. Do not open public issues for sensitive reports.

## Deployment guidance

- Set `API_KEY` and require it for all expensive/mutating endpoints.
- Set `ALLOWED_ORIGINS` to explicit trusted origins. Avoid wildcard Vercel origins with credentials unless you fully understand the risk.
- Set `EXPOSE_HEALTH_DETAILS=false` on public deployments.
- Configure upload limits (`MAX_UPLOAD_MB`) and object storage lifecycle policies.
- If R2 is not configured, local serving is limited to generated output subtrees
  (`/static/{outputs,audio,video,thumbs}`); reference audio, fonts, and job inputs
  are never mounted. Treat it as a development fallback and do not expose it
  publicly without auth and isolation.
- Rotate API/provider keys regularly and use least-privilege credentials.

## Known limitations

- Rate limiting uses Redis when `REDIS_URL` is configured and falls back to
  process-local buckets only when Redis was never selected. Trust
  `X-Forwarded-For` only behind `TRUST_X_FORWARDED_FOR=true`.
- Process-local synthesis/reference caches are not shared across workers.
- Uploaded/generated media should be treated as untrusted input; use sandboxing, quotas, and malware/media scanning in production.
