type Bucket = {
  failures: number[]
  lockedUntil: number
}

const buckets = new Map<string, Bucket>()

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 8
const LOCKOUT_MS = 15 * 60 * 1000

function keyFor(ip: string, email?: string): string {
  return `${ip || 'unknown'}|${(email || '').toLowerCase().trim()}`
}

function prune(bucket: Bucket, now: number) {
  bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS)
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export function checkAuthRateLimit(
  ip: string,
  email?: string,
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const key = keyFor(ip, email)
  const bucket = buckets.get(key)
  if (!bucket) return { allowed: true }

  if (bucket.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((bucket.lockedUntil - now) / 1000),
    }
  }

  prune(bucket, now)
  if (bucket.failures.length >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCKOUT_MS
    return { allowed: false, retryAfterSec: Math.ceil(LOCKOUT_MS / 1000) }
  }

  return { allowed: true }
}

export function recordAuthFailure(ip: string, email?: string): void {
  const now = Date.now()
  const key = keyFor(ip, email)
  const bucket = buckets.get(key) || { failures: [], lockedUntil: 0 }
  prune(bucket, now)
  bucket.failures.push(now)
  if (bucket.failures.length >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCKOUT_MS
  }
  buckets.set(key, bucket)
}

export function clearAuthFailures(ip: string, email?: string): void {
  buckets.delete(keyFor(ip, email))
}
