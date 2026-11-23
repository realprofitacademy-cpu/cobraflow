/**
 * Nono dígito brasileiro: a mesma pessoa chega com 12 ou 13 dígitos.
 *
 * ─── O problema, medido contra a WABA real em 2026-07-29 ─────────────────────
 *   envio (funcionou)        5531998966398   13 dígitos
 *   `wa_id` do inbound        553198966398   12 dígitos, sem o nono
 *
 * Sem tratar, o contato que recebe e o que responde viram DOIS — conversa
 * partida, histórico fragmentado, e silencioso.
 *
 * ─── O que o CRM guarda e mostra ────────────────────────────────────────────
 * Celular BR é sempre a forma COM o nono (`+5532984793302`). É o que o
 * brasileiro espera ler e copiar. Fixo (local 2–5) e número de outro país
 * ficam como chegaram — inventar um 9 num fixo fundiria duas pessoas.
 *
 * ─── O que o WhatsApp/WAHA aceitam ──────────────────────────────────────────
 * O wa_id registrado pode omitir o 9. A busca usa as DUAS grafias
 * (`phoneLookupVariants`); o envio pergunta ao transporte (`check-exists`)
 * qual delas existe, em `lib/waha/resolve-contact-whatsapp-id.ts`. Não
 * adivinhar o formato de envio a partir do cadastro.
 */

import { normalizePhoneNumber } from "./phone-normalization";

/** Só dígitos, sem `+`. */
function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Formas pelas quais este número pode estar gravado. A primeira é sempre a original;
 * a segunda (quando existe) é a contraparte com/sem o nono dígito (Brasil) ou
 * formato internacional E.164 canónico / formato local (Venezuela +58).
 *
 * Devolve E.164 **com `+`**, que é como `contacts.phone_number` guarda.
 */
export function phoneLookupVariants(raw: string): string[] {
  const d = digitsOf(raw);
  if (d.length === 0) return [];

  const original = `+${d}`;

  // ── Tratamento para Venezuela (+58) ───────────────────────────────────────
  if (d.startsWith("58") && d.length === 12) {
    return [original, `+0${d.slice(2)}`];
  }
  if (d.startsWith("0") && d.length === 11 && /^0(412|414|424|416|426|212|241|261)/.test(d)) {
    return [original, `+58${d.slice(1)}`];
  }
  if (d.length === 10 && /^(412|414|424|416|426|212|241|261)/.test(d)) {
    return [original, `+58${d}`, `+0${d}`];
  }

  // Fora do Brasil o nono dígito não existe — variante única, sem inventar regra.
  if (!d.startsWith("55")) return [original];

  const ddd = d.slice(2, 4);
  const local = d.slice(4);
  // DDD brasileiro válido começa em 1 (11..99). Fora disso não arriscamos nada.
  if (ddd.length !== 2 || !/^[1-9][0-9]$/.test(ddd)) return [original];

  // 12 dígitos: 55 + DDD + 8 locais. Celular antigo perdeu o 9 → a variante o devolve.
  // Só quando o local começa em 6-9, que é a faixa de celular; 2-5 é fixo e fica fora.
  if (local.length === 8) {
    if (!/^[6-9]/.test(local)) return [original];
    return [original, `+55${ddd}9${local}`];
  }

  // 13 dígitos: 55 + DDD + 9 locais começando em 9 → a variante remove o nono.
  if (local.length === 9 && local.startsWith("9") && /^[6-9]/.test(local.slice(1))) {
    return [original, `+55${ddd}${local.slice(1)}`];
  }

  return [original];
}

/**
 * Forma canônica de CRM: celular BR sempre COM o nono dígito; Venezuela (+58)
 * sempre em E.164 com código de país (+58412... / +58212...).
 */
export function canonicalPhone(raw: string): string {
  const normVE = normalizePhoneNumber(raw);
  if (normVE && normVE.startsWith("+58")) {
    return normVE;
  }
  const variants = phoneLookupVariants(raw);
  if (variants.length === 0) return raw.trim();
  return variants.reduce((a, b) => (digitsOf(a).length >= digitsOf(b).length ? a : b));
}

/** Alias retrocompatível com a base DeskcommCRM */
export const canonicalPhoneBR = canonicalPhone;

/** Exibição: mesma regra da gravação. Vazio continua vazio. */
export function phoneForDisplay(raw: string | null | undefined): string {
  if (raw == null || !raw.trim()) return "";
  return canonicalPhoneBR(raw);
}

/**
 * Os dois números são a MESMA pessoa, considerando o nono dígito?
 *
 * Útil para asserção e para decidir merge.
 */
export function samePhone(a: string, b: string): boolean {
  const va = new Set(phoneLookupVariants(a));
  return phoneLookupVariants(b).some((v) => va.has(v));
}

/** O número da lista que é o mesmo telefone de `numero`, considerando o nono dígito. */
export function mesmoTelefoneNaLista(
  numeros: ReadonlyArray<string | null | undefined>,
  numero: string,
): string | undefined {
  return numeros.find((n): n is string => Boolean(n) && samePhone(n as string, numero));
}

/** Normaliza telefone BR para E.164 com o nono dígito no celular. */
export function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  let e164: string | null = null;
  if (raw.trim().startsWith("+")) {
    e164 = /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  } else if (digits.length === 12 || digits.length === 13) {
    e164 = digits.startsWith("55") ? `+${digits}` : null;
  } else if (digits.length === 10 || digits.length === 11) {
    e164 = `+55${digits}`;
  }
  return e164 ? canonicalPhoneBR(e164) : null;
}
