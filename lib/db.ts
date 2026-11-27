import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL belum diatur di Environment Variables.");
}

export const sql = neon(process.env.DATABASE_URL);

// Menghitung jarak antar 2 koordinat GPS dalam satuan meter (Rumus Haversine)
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Radius bumi dalam meter
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Mengecek keterlambatan berdasarkan zona waktu WIB (Asia/Jakarta)
export function evaluateLateness(
  punchedAtIso: string,
  shiftStartTime: string,
  graceMinutes: number
): { isLate: boolean; lateMinutes: number } {
  const dateObj = new Date(punchedAtIso);
  const jakartaString = dateObj.toLocaleString("en-US", {
    timeZone: "Asia/Jakarta",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });

  const [punchH, punchM] = jakartaString.split(":").map(Number);
  const [shiftH, shiftM] = (shiftStartTime || "08:00").split(":").map(Number);

  const punchTotalMinutes = punchH * 60 + punchM;
  const allowedTotalMinutes = shiftH * 60 + shiftM + (graceMinutes || 0);

  if (punchTotalMinutes > allowedTotalMinutes) {
    return {
      isLate: true,
      lateMinutes: punchTotalMinutes - (shiftH * 60 + shiftM),
    };
  }
  return { isLate: false, lateMinutes: 0 };
}
