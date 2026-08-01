import crypto from 'crypto'

/** Hash a password using PBKDF2 with SHA-512 */
export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')
}

export function verifyPassword(password: string, salt: string, passwordHash: string): boolean {
  const computed = hashPassword(password, salt)
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(passwordHash, 'hex'))
  } catch {
    return computed === passwordHash
  }
}
