/**
 * Detects encoded payloads — base64, hex, or other encodings hiding instructions.
 */

import type { PromptGuardRule, RuleDetection } from '../types';

// Base64 pattern: reasonably long string of base64 chars
const BASE64_PATTERN = /(?:^|\s)([A-Za-z0-9+/]{20,}={0,2})(?:\s|$)/g;

// Hex-encoded strings
const HEX_PATTERN = /(?:0x|\\x)([0-9a-fA-F]{2}){8,}/g;

// Unicode escape sequences
const UNICODE_ESCAPE_PATTERN = /(?:\\u[0-9a-fA-F]{4}){4,}/g;

// Suspicious keywords that might appear in decoded content
const SUSPICIOUS_DECODED = /(?:ignore|system|override|instructions?|you\s+are|forget|disregard)/i;

function tryBase64Decode(str: string): string | null {
  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8');
    // Check if decoded content is mostly printable ASCII
    const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
    if (printableRatio > 0.8 && decoded.length > 5) {
      return decoded;
    }
  } catch {
    // Not valid base64
  }
  return null;
}

function tryHexDecode(str: string): string | null {
  try {
    const hex = str.replace(/0x|\\x/g, '');
    const decoded = Buffer.from(hex, 'hex').toString('utf-8');
    const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
    if (printableRatio > 0.8 && decoded.length > 5) {
      return decoded;
    }
  } catch {
    // Not valid hex
  }
  return null;
}

export const encodedPayloadRule: PromptGuardRule = {
  id: 'encoded-payload',
  name: 'Encoded Payload Detection',
  category: 'obfuscation',

  detect(text: string): RuleDetection {
    let maxScore = 0;
    const evidence: string[] = [];

    // Check base64
    BASE64_PATTERN.lastIndex = 0;
    for (let match = BASE64_PATTERN.exec(text); match !== null; match = BASE64_PATTERN.exec(text)) {
      const decoded = tryBase64Decode(match[1]);
      if (decoded && SUSPICIOUS_DECODED.test(decoded)) {
        maxScore = Math.max(maxScore, 0.9);
        evidence.push(`base64-suspicious: decoded contains injection pattern`);
      } else if (decoded) {
        // Long base64 string that decodes to readable text — mildly suspicious
        maxScore = Math.max(maxScore, 0.3);
        evidence.push(`base64-readable: ${match[1].substring(0, 30)}...`);
      }
    }

    // Check hex
    HEX_PATTERN.lastIndex = 0;
    for (let match = HEX_PATTERN.exec(text); match !== null; match = HEX_PATTERN.exec(text)) {
      const decoded = tryHexDecode(match[0]);
      if (decoded && SUSPICIOUS_DECODED.test(decoded)) {
        maxScore = Math.max(maxScore, 0.9);
        evidence.push(`hex-suspicious: decoded contains injection pattern`);
      } else if (decoded) {
        maxScore = Math.max(maxScore, 0.3);
        evidence.push(`hex-readable: ${match[0].substring(0, 30)}...`);
      }
    }

    // Check unicode escapes
    UNICODE_ESCAPE_PATTERN.lastIndex = 0;
    if (UNICODE_ESCAPE_PATTERN.test(text)) {
      maxScore = Math.max(maxScore, 0.5);
      evidence.push('unicode-escapes: multiple unicode escape sequences detected');
    }

    return {
      match: evidence.length > 0,
      score: maxScore,
      evidence: evidence.join('; ') || '',
    };
  },
};
