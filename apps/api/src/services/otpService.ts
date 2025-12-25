/**
 * OTP Service (Ticket 05)
 * 
 * Handles OTP (One-Time Password) generation, storage, and verification.
 * Uses Cloudflare KV (OTP_STORE) for storage with TTL.
 * 
 * Key Format: otp:{purpose}:{token}:{emailHash}
 * 
 * Purposes:
 * - email_verify: Email verification during signup
 * - password_reset: Password reset flow
 * - invite_accept: Accept relationship invite (via /i/:token)
 * - login: Passwordless login
 */

// Note: Using Web Crypto API (Cloudflare Workers compatible)

export interface OTPGenerateOptions {
  email: string;
  purpose: 'email_verify' | 'password_reset' | 'invite_accept' | 'login';
  expirySeconds?: number; // Default: 600 (10 minutes)
  length?: number;        // Default: 6
}

export interface OTPVerifyOptions {
  email: string;
  purpose: string;
  code: string;
}

export interface OTPVerifyResult {
  valid: boolean;
  remainingAttempts?: number;
  error?: string;
}

export class OTPService {
  private readonly DEFAULT_EXPIRY = 600; // 10 minutes
  private readonly DEFAULT_LENGTH = 6;
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly kv: KVNamespace,
    private readonly analytics?: AnalyticsEngineDataset
  ) {}

  /**
   * Generate random numeric OTP code
   */
  private generateCode(length: number): string {
    const digits = '0123456789';
    let code = '';
    
    // Use crypto.getRandomValues for better randomness
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < length; i++) {
      code += digits[randomValues[i] % digits.length];
    }
    
    return code;
  }

  /**
   * Generate random token for key
   */
  private generateToken(): string {
    return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  }

  /**
   * Hash email for privacy using Web Crypto API
   */
  private async hashEmail(email: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 16);
  }

  /**
   * Build KV key
   */
  private async buildKey(purpose: string, token: string, email: string): Promise<string> {
    const emailHash = await this.hashEmail(email);
    return `otp:${purpose}:${token}:${emailHash}`;
  }

  /**
   * Enhanced generate with automatic lookup storage
   */
  async generateWithLookup(options: OTPGenerateOptions): Promise<{ code: string; token: string }> {
    const {
      email,
      purpose,
      expirySeconds = this.DEFAULT_EXPIRY,
      length = this.DEFAULT_LENGTH,
    } = options;

    // Generate code and token
    const code = this.generateCode(length);
    const token = this.generateToken();
    const key = await this.buildKey(purpose, token, email);

    // Store OTP with metadata
    const otpData = {
      email,
      code,
      purpose,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + expirySeconds * 1000,
    };

    await this.kv.put(key, JSON.stringify(otpData), {
      expirationTtl: expirySeconds,
    });

    // Store lookup key
    await this.storeLookup(purpose, email, token, expirySeconds);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['otp_generated', purpose, email],
        doubles: [Date.now()],
        indexes: [`otp_${purpose}`],
      });
    }

    console.log(`[OTP] Generated for ${email} (${purpose}): ${code}`);
    return { code, token };
  }

  /**
   * Verify OTP code
   */
  async verify(options: OTPVerifyOptions): Promise<OTPVerifyResult> {
    const { email, purpose, code } = options;

    // Find OTP key via lookup
    const key = await this.findOTPKey(purpose, email);
    
    if (!key) {
      return {
        valid: false,
        error: 'OTP not found or expired',
      };
    }

    // Get stored OTP data
    const storedData = await this.kv.get(key);
    if (!storedData) {
      return {
        valid: false,
        error: 'OTP expired',
      };
    }

    const otpData = JSON.parse(storedData);

    // Check expiry
    if (Date.now() > otpData.expiresAt) {
      await this.kv.delete(key);
      return {
        valid: false,
        error: 'OTP expired',
      };
    }

    // Check attempts
    if (otpData.attempts >= this.MAX_ATTEMPTS) {
      await this.kv.delete(key);
      return {
        valid: false,
        error: 'Maximum attempts exceeded',
      };
    }

    // Increment attempts
    otpData.attempts += 1;
    await this.kv.put(key, JSON.stringify(otpData), {
      expirationTtl: Math.ceil((otpData.expiresAt - Date.now()) / 1000),
    });

    // Verify code
    if (otpData.code !== code) {
      // Track analytics for failed attempt
      if (this.analytics) {
        this.analytics.writeDataPoint({
          blobs: ['otp_failed', purpose, email],
          doubles: [Date.now()],
          indexes: [`otp_verify_${purpose}`],
        });
      }

      return {
        valid: false,
        remainingAttempts: this.MAX_ATTEMPTS - otpData.attempts,
        error: 'Invalid OTP code',
      };
    }

    // Success - delete OTP and lookup
    await this.kv.delete(key);
    const emailHash = await this.hashEmail(email);
    await this.kv.delete(`otp:lookup:${purpose}:${emailHash}`);

    // Track analytics for success
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['otp_verified', purpose, email],
        doubles: [Date.now()],
        indexes: [`otp_verify_${purpose}`],
      });
    }

    return {
      valid: true,
    };
  }

  /**
   * Find OTP key by purpose and email
   */
  private async findOTPKey(purpose: string, email: string): Promise<string | null> {
    const emailHash = await this.hashEmail(email);
    const lookupKey = `otp:lookup:${purpose}:${emailHash}`;
    
    const token = await this.kv.get(lookupKey);
    if (!token) {
      return null;
    }

    return await this.buildKey(purpose, token, email);
  }

  /**
   * Store reverse lookup key for efficient verification
   */
  private async storeLookup(
    purpose: string,
    email: string,
    token: string,
    expirySeconds: number
  ): Promise<void> {
    const emailHash = await this.hashEmail(email);
    const lookupKey = `otp:lookup:${purpose}:${emailHash}`;
    
    await this.kv.put(lookupKey, token, {
      expirationTtl: expirySeconds,
    });
  }
}
