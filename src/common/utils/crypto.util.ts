import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SECRET_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'agncypay-fintech-encryption-key-32b-secret';

function getKey(): Buffer {
  return crypto.scryptSync(SECRET_KEY, 'agncypay-salt', 32);
}

export function encryptText(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptText(encryptedText: string): string {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText; // Return as-is if unencrypted legacy format

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const key = getKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    return encryptedText; // Fallback to raw text if decryption fails
  }
}
