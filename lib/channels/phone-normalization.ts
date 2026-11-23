/**
 * COBRAFLOW — NORMALIZACIÓN DE TELÉFONOS (VENEZUELA + INTERNACIONAL E.164)
 *
 * Maneja los formatos habituales de números en Venezuela:
 * - Móviles: 0412, 0414, 0424, 0416, 0426 -> +58412..., +58414...
 * - Fijos: 0212, 0241, 0261, etc. -> +58212..., +58241...
 * - Con código de país sin '+': 584121234567 -> +584121234567
 * - Internacionales con '+': se preservan bajo norma E.164
 */

export function normalizePhoneNumber(raw: unknown, defaultCountryCode = "58"): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) return null;

  // 1. Si ya viene con '+' y longitud válida, retornar en E.164
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }

  // 2. Si comienza con código de país de Venezuela (58) y tiene 12 dígitos (58 + 10 dígitos)
  if (digits.startsWith("58") && digits.length === 12) {
    return `+${digits}`;
  }

  // 3. Formato local venezolano con cero: 0412xxxxxxx (11 dígitos)
  if (digits.startsWith("0") && digits.length === 11) {
    const withoutLeadingZero = digits.slice(1);
    return `+${defaultCountryCode}${withoutLeadingZero}`;
  }

  // 4. Formato local venezolano sin cero: 412xxxxxxx (10 dígitos)
  if (
    digits.length === 10 &&
    (digits.startsWith("412") ||
      digits.startsWith("414") ||
      digits.startsWith("424") ||
      digits.startsWith("416") ||
      digits.startsWith("426") ||
      digits.startsWith("212"))
  ) {
    return `+${defaultCountryCode}${digits}`;
  }

  // 5. Formato internacional sin '+' (ej. Brasil 55..., USA 1...)
  if (digits.length >= 10 && !digits.startsWith("0")) {
    return `+${digits}`;
  }

  return null;
}

/** Formato legible para el Inbox (ej. +58 412-1234567) */
export function formatPhoneForDisplay(phoneE164: string | null | undefined): string {
  if (!phoneE164) return "";
  const cleaned = phoneE164.replace(/\D/g, "");

  if (phoneE164.startsWith("+58") && cleaned.length === 12) {
    // +58 412 1234567
    return `+58 (${cleaned.slice(2, 5)}) ${cleaned.slice(5, 8)}-${cleaned.slice(8)}`;
  }

  return phoneE164;
}
