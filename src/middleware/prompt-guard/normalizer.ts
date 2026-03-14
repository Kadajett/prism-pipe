/**
 * Unicode normalization layer for prompt guard.
 *
 * Strips zero-width characters, resolves homoglyphs, detects emoji smuggling,
 * and removes RTL overrides — all while preserving legitimate Unicode (CJK, emoji, etc.).
 */

// Zero-width characters that serve no legitimate purpose in prompt text
const ZERO_WIDTH_CHARS = /\u200B|\u200C|\u200D|\uFEFF|\u00AD|\u2060|\u180E/g;

// RTL/LTR override characters used for bidirectional text attacks
const BIDI_OVERRIDES = /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;

// Variation selectors (VS1-VS16, VS17-VS256) used in emoji smuggling
const VARIATION_SELECTORS = /[\uFE00-\uFE0F]|\uDB40[\uDD00-\uDDEF]/g;

// Tag characters (U+E0001-U+E007F) used in invisible text encoding
// Must use Unicode property escapes or surrogate pairs — \uXXXX only supports 4 hex digits
const TAG_CHARACTERS = /\uDB40[\uDC01-\uDC7F]/g;

// Cyrillic → Latin homoglyph map (most common confusables)
const CYRILLIC_TO_LATIN: Record<string, string> = {
  '\u0410': 'A',
  '\u0430': 'a', // А/а
  '\u0412': 'B',
  '\u0432': 'v', // В/в (В→B visually)
  '\u0421': 'C',
  '\u0441': 'c', // С/с
  '\u0415': 'E',
  '\u0435': 'e', // Е/е
  '\u041D': 'H',
  '\u043D': 'h', // Н/н
  '\u041A': 'K',
  '\u043A': 'k', // К/к
  '\u041C': 'M',
  '\u043C': 'm', // М/м
  '\u041E': 'O',
  '\u043E': 'o', // О/о
  '\u0420': 'P',
  '\u0440': 'p', // Р/р
  '\u0422': 'T',
  '\u0442': 't', // Т/т
  '\u0425': 'X',
  '\u0445': 'x', // Х/х
  '\u0423': 'Y',
  '\u0443': 'y', // У/у
  '\u0417': '3', // З → 3
  '\u0406': 'I',
  '\u0456': 'i', // І/і (Ukrainian)
  '\u0408': 'J',
  '\u0458': 'j', // Ј/ј (Serbian)
  '\u0405': 'S',
  '\u0455': 's', // Ѕ/ѕ (Macedonian)
};

// Greek → Latin homoglyph map
const GREEK_TO_LATIN: Record<string, string> = {
  '\u0391': 'A',
  '\u03B1': 'a', // Α/α
  '\u0392': 'B',
  '\u03B2': 'b', // Β/β
  '\u0395': 'E',
  '\u03B5': 'e', // Ε/ε
  '\u0397': 'H',
  '\u03B7': 'h', // Η/η
  '\u0399': 'I',
  '\u03B9': 'i', // Ι/ι
  '\u039A': 'K',
  '\u03BA': 'k', // Κ/κ
  '\u039C': 'M',
  '\u03BC': 'm', // Μ/μ
  '\u039D': 'N',
  '\u03BD': 'n', // Ν/ν
  '\u039F': 'O',
  '\u03BF': 'o', // Ο/ο
  '\u03A1': 'P',
  '\u03C1': 'p', // Ρ/ρ
  '\u03A4': 'T',
  '\u03C4': 't', // Τ/τ
  '\u03A5': 'Y',
  '\u03C5': 'y', // Υ/υ
  '\u03A7': 'X',
  '\u03C7': 'x', // Χ/χ
  '\u0396': 'Z',
  '\u03B6': 'z', // Ζ/ζ
};

// Combined homoglyph map
const HOMOGLYPH_MAP: Record<string, string> = {
  ...CYRILLIC_TO_LATIN,
  ...GREEK_TO_LATIN,
  // Additional common confusables
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-', // Various dashes
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"', // Smart quotes
  '\uFF01': '!',
  '\uFF1F': '?',
  '\uFF0E': '.',
  '\uFF0C': ',', // Fullwidth punctuation
};

/**
 * Normalize text for injection detection.
 * Preserves legitimate Unicode (CJK characters, standard emoji) while
 * neutralizing obfuscation techniques.
 */
export function normalizeText(text: string): string {
  // 1. NFC normalization (compose decomposed characters)
  let normalized = text.normalize('NFC');

  // 2. Strip zero-width characters
  normalized = normalized.replace(ZERO_WIDTH_CHARS, '');

  // 3. Strip RTL/LTR overrides
  normalized = normalized.replace(BIDI_OVERRIDES, '');

  // 4. Strip variation selectors (emoji smuggling)
  normalized = normalized.replace(VARIATION_SELECTORS, '');

  // 5. Strip tag characters
  normalized = normalized.replace(TAG_CHARACTERS, '');

  // 6. Resolve homoglyphs
  normalized = resolveHomoglyphs(normalized);

  // 7. Collapse excessive whitespace (but preserve newlines)
  normalized = normalized.replace(/[^\S\n]+/g, ' ');
  normalized = normalized.replace(/\n{4,}/g, '\n\n\n');

  return normalized.trim();
}

/**
 * Replace known homoglyph characters with their Latin equivalents.
 * Only replaces characters that appear in mixed-script contexts to
 * avoid destroying legitimate Cyrillic/Greek text.
 */
function resolveHomoglyphs(text: string): string {
  let result = '';
  for (const char of text) {
    result += HOMOGLYPH_MAP[char] ?? char;
  }
  return result;
}

/**
 * Detect if text contains suspicious Unicode patterns
 * (useful for scoring even if normalization handles them).
 */
export function detectUnicodeAnomalies(text: string): {
  hasZeroWidth: boolean;
  hasBidiOverrides: boolean;
  hasHomoglyphs: boolean;
  hasVariationSelectors: boolean;
  anomalyCount: number;
} {
  const hasZeroWidth = ZERO_WIDTH_CHARS.test(text);
  const hasBidiOverrides = BIDI_OVERRIDES.test(text);
  const hasVariationSelectors = VARIATION_SELECTORS.test(text);

  let hasHomoglyphs = false;
  for (const char of text) {
    if (HOMOGLYPH_MAP[char]) {
      hasHomoglyphs = true;
      break;
    }
  }

  // Reset regex lastIndex
  ZERO_WIDTH_CHARS.lastIndex = 0;
  BIDI_OVERRIDES.lastIndex = 0;
  VARIATION_SELECTORS.lastIndex = 0;

  const anomalyCount = [
    hasZeroWidth,
    hasBidiOverrides,
    hasHomoglyphs,
    hasVariationSelectors,
  ].filter(Boolean).length;

  return { hasZeroWidth, hasBidiOverrides, hasHomoglyphs, hasVariationSelectors, anomalyCount };
}
