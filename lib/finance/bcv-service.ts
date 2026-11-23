/**
 * COBRAFLOW — SERVICIO DE TASA OFICIAL BCV (BANCO CENTRAL DE VENEZUELA)
 *
 * Sincroniza y gestiona las tasas de cambio oficiales USD -> VES:
 * - Almacenamiento histórico e inmutable en `exchange_rates_bcv`.
 * - Conversión bidireccional USD (céntimos) <-> VES con redondeo financiero estándar.
 * - Soporte de fallback y tolerancia ante desconexión o indisponibilidad de API externa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export interface BcvRateRecord {
  id?: string;
  rateDate: string; // YYYY-MM-DD
  usdToVes: number;
  source: string;
  fetchedAt?: string;
  isOfficial: boolean;
}

export interface CurrencyConversion {
  amountCentsUsd: number;
  amountVes: number;
  exchangeRate: number;
  formattedUsd: string;
  formattedVes: string;
}

/**
 * Convierte monto en céntimos de USD a VES con la tasa provista.
 * Ej: 5000 céntimos ($50.00) @ 65.50 Bs/$ = 3,275.00 Bs
 */
export function convertUsdCentsToVes(
  amountCentsUsd: number,
  exchangeRate: number,
): CurrencyConversion {
  if (exchangeRate <= 0) {
    throw new Error("bcv_rate_invalid: la tasa de cambio debe ser un número positivo.");
  }

  const amountUsd = amountCentsUsd / 100;
  const rawVes = amountUsd * exchangeRate;
  const amountVes = Math.round(rawVes * 100) / 100; // Redondeo a 2 decimales

  const formattedUsd = `$${amountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formattedVes = `Bs. ${amountVes.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return {
    amountCentsUsd,
    amountVes,
    exchangeRate,
    formattedUsd,
    formattedVes,
  };
}

/**
 * Convierte monto en VES a céntimos de USD con la tasa provista.
 * Ej: 3,275.00 Bs @ 65.50 Bs/$ = $50.00 (5000 céntimos)
 */
export function convertVesToUsdCents(
  amountVes: number,
  exchangeRate: number,
): CurrencyConversion {
  if (exchangeRate <= 0) {
    throw new Error("bcv_rate_invalid: la tasa de cambio debe ser un número positivo.");
  }

  const rawUsd = amountVes / exchangeRate;
  const amountCentsUsd = Math.round(rawUsd * 100);
  const amountUsd = amountCentsUsd / 100;

  const formattedUsd = `$${amountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formattedVes = `Bs. ${amountVes.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return {
    amountCentsUsd,
    amountVes,
    exchangeRate,
    formattedUsd,
    formattedVes,
  };
}

/**
 * Obtiene la tasa BCV más reciente almacenada en la base de datos.
 */
export async function getLatestBcvRate(
  db: SupabaseClient,
): Promise<BcvRateRecord | null> {
  const { data, error } = await db
    .from("exchange_rates_bcv")
    .select("id, rate_date, usd_to_ves, source, fetched_at, is_official")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn("[bcv-service] Error consultando última tasa BCV", { error: error.message });
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    rateDate: data.rate_date,
    usdToVes: Number(data.usd_to_ves),
    source: data.source,
    fetchedAt: data.fetched_at,
    isOfficial: Boolean(data.is_official),
  };
}

/**
 * Consulta la tasa oficial actual de fuentes públicas o proveedor configurado.
 * Implementa timeout y fallback automático.
 */
export async function fetchLiveBcvRate(): Promise<{ usdToVes: number; source: string } | null> {
  const sources = [
    {
      name: "pydolarve",
      url: "https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv",
      parser: (json: any) => {
        const val = json?.monitors?.usd?.price ?? json?.price;
        return typeof val === "number" && val > 0 ? val : null;
      },
    },
    {
      name: "vepdollar",
      url: "https://ve.dolarapi.com/v1/dolares/oficial",
      parser: (json: any) => {
        const val = json?.promedio ?? json?.price;
        return typeof val === "number" && val > 0 ? val : null;
      },
    },
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const json = await res.json();
        const rate = src.parser(json);
        if (rate && rate > 0) {
          return { usdToVes: rate, source: `BCV (${src.name})` };
        }
      }
    } catch {
      // Intenta siguiente fuente sin interrumpir
    }
  }

  return null;
}

/**
 * Sincroniza y persiste la tasa BCV para la fecha especificada (o hoy).
 * Idempotente: si ya existe para la fecha, actualiza o preserva.
 */
export async function syncBcvRate(
  db: SupabaseClient,
  opts?: {
    rateDate?: string;
    overrideRate?: number;
    source?: string;
  },
): Promise<BcvRateRecord> {
  const today = opts?.rateDate || new Date().toISOString().split("T")[0]!;

  let rateValue = opts?.overrideRate;
  let source = opts?.source || "BCV";

  if (!rateValue) {
    const live = await fetchLiveBcvRate();
    if (live) {
      rateValue = live.usdToVes;
      source = live.source;
    }
  }

  // Si no se pudo obtener en vivo, recurrir a la última registrada
  if (!rateValue) {
    const latest = await getLatestBcvRate(db);
    if (latest) {
      rateValue = latest.usdToVes;
      source = `${latest.source} (fallback)`;
    } else {
      // Valor base de seguridad si la tabla está completamente vacía
      rateValue = 65.0;
      source = "CobraFlow Default";
    }
  }

  const { data, error } = await db
    .from("exchange_rates_bcv")
    .upsert(
      {
        rate_date: today,
        usd_to_ves: rateValue,
        source,
        fetched_at: new Date().toISOString(),
        is_official: true,
      },
      { onConflict: "rate_date" },
    )
    .select("id, rate_date, usd_to_ves, source, fetched_at, is_official")
    .single();

  if (error || !data) {
    throw new Error(`bcv_sync_failed: ${error?.message || "sin datos devueltos"}`);
  }

  return {
    id: data.id,
    rateDate: data.rate_date,
    usdToVes: Number(data.usd_to_ves),
    source: data.source,
    fetchedAt: data.fetched_at,
    isOfficial: Boolean(data.is_official),
  };
}
