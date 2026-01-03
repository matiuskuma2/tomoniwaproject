/**
 * Email utility functions
 * - Normalization for consistent email matching
 * - Used by: Billing Gate, User lookup, Contact management
 */

/**
 * Normalize email address for consistent matching
 * - Convert to lowercase
 * - Trim whitespace
 * 
 * @param email - Email address to normalize
 * @returns Normalized email address
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}
