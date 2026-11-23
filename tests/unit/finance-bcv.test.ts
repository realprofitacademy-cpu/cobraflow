import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  convertUsdCentsToVes,
  convertVesToUsdCents,
  getLatestBcvRate,
  syncBcvRate,
} from "@/lib/finance/bcv-service";

describe("CobraFlow — Módulo Financiero: Servicio de Tasas BCV", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Conversión de Moneda", () => {
    it("convierte céntimos USD a VES con redondeo a 2 decimales", () => {
      // $50.00 (5000 céntimos) a tasa 65.50 Bs/$ = 3,275.00 Bs
      const res1 = convertUsdCentsToVes(5000, 65.5);
      expect(res1.amountVes).toBe(3275.0);
      expect(res1.formattedUsd).toBe("$50.00");
      expect(res1.formattedVes).toContain("3.275,00");

      // $12.34 (1234 céntimos) a tasa 66.1234 Bs/$ = 815.96 Bs
      const res2 = convertUsdCentsToVes(1234, 66.1234);
      expect(res2.amountVes).toBe(815.96);
    });

    it("convierte VES a céntimos USD con precisión", () => {
      // 3,275.00 Bs a tasa 65.50 Bs/$ = $50.00 (5000 céntimos)
      const res1 = convertVesToUsdCents(3275.0, 65.5);
      expect(res1.amountCentsUsd).toBe(5000);
      expect(res1.formattedUsd).toBe("$50.00");

      // 65.50 Bs a tasa 65.50 Bs/$ = $1.00 (100 céntimos)
      const res2 = convertVesToUsdCents(65.5, 65.5);
      expect(res2.amountCentsUsd).toBe(100);
    });

    it("lanza error si la tasa es cero o negativa", () => {
      expect(() => convertUsdCentsToVes(1000, 0)).toThrow(/bcv_rate_invalid/);
      expect(() => convertVesToUsdCents(1000, -10)).toThrow(/bcv_rate_invalid/);
    });
  });

  describe("Persistencia y Sincronización de Tasa BCV", () => {
    it("recupera la última tasa registrada en la base de datos", async () => {
      const mockDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "11111111-1111-4111-8111-111111111111",
                    rate_date: "2026-11-23",
                    usd_to_ves: 65.45,
                    source: "BCV",
                    fetched_at: "2026-11-23T12:00:00Z",
                    is_official: true,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      const rate = await getLatestBcvRate(mockDb as never);
      expect(rate).not.toBeNull();
      expect(rate?.usdToVes).toBe(65.45);
      expect(rate?.rateDate).toBe("2026-11-23");
      expect(rate?.isOfficial).toBe(true);
    });

    it("sincroniza e inserta la tasa con override manual", async () => {
      const mockUpsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "22222222-2222-4222-8222-222222222222",
              rate_date: "2026-11-23",
              usd_to_ves: 66.0,
              source: "BCV Oficial",
              fetched_at: "2026-11-23T15:00:00Z",
              is_official: true,
            },
            error: null,
          }),
        }),
      });

      const mockDb = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert,
        }),
      };

      const synced = await syncBcvRate(mockDb as never, {
        rateDate: "2026-11-23",
        overrideRate: 66.0,
        source: "BCV Oficial",
      });

      expect(synced.usdToVes).toBe(66.0);
      expect(synced.source).toBe("BCV Oficial");
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          rate_date: "2026-11-23",
          usd_to_ves: 66.0,
          source: "BCV Oficial",
          is_official: true,
        }),
        expect.objectContaining({ onConflict: "rate_date" }),
      );
    });
  });
});
