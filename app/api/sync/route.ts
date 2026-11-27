import { NextResponse } from "next/server";
import { sql, calculateDistanceMeters, evaluateLateness } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const punches = Array.isArray(body.punches) ? body.punches : [body];

    const locations = await sql`SELECT * FROM locations`;
    const employees = await sql`
      SELECT e.id, s.start_time, s.grace_minutes
      FROM employees e
      LEFT JOIN shifts s ON e.shift_id = s.id
    `;

    const empMap = new Map(employees.map((e: any) => [Number(e.id), e]));
    let syncedCount = 0;

    for (const p of punches) {
      if (!p.client_uuid || !p.employee_id || !p.entry_type || !p.punched_at) {
        continue;
      }

      const emp = empMap.get(Number(p.employee_id));
      let matchedLocationId = p.location_id ? Number(p.location_id) : null;
      let minDistance: number | null = null;
      let isWithinGeofence = true;

      if (
        typeof p.latitude === "number" &&
        typeof p.longitude === "number" &&
        locations.length > 0
      ) {
        let bestLoc = locations[0];
        let bestDist = calculateDistanceMeters(
          p.latitude,
          p.longitude,
          Number(bestLoc.latitude),
          Number(bestLoc.longitude)
        );

        for (const loc of locations) {
          const d = calculateDistanceMeters(
            p.latitude,
            p.longitude,
            Number(loc.latitude),
            Number(loc.longitude)
          );
          if (d < bestDist) {
            bestDist = d;
            bestLoc = loc;
          }
        }

        matchedLocationId = Number(bestLoc.id);
        minDistance = bestDist;
        isWithinGeofence = bestDist <= Number(bestLoc.radius_meters);
      }

      let isLate = false;
      let lateMinutes = 0;
      if (p.entry_type === "CLOCK_IN" && emp) {
        const check = evaluateLateness(
          p.punched_at,
          emp.start_time || "08:00",
          Number(emp.grace_minutes ?? 10)
        );
        isLate = check.isLate;
        lateMinutes = check.lateMinutes;
      }

      await sql`
        INSERT INTO time_entries (
          client_uuid, employee_id, entry_type, punched_at, is_offline_sync,
          project_id, activity_name, location_id, latitude, longitude,
          distance_meters, is_within_geofence, selfie_data, notes,
          is_late, late_minutes, approval_status
        ) VALUES (
          ${p.client_uuid},
          ${Number(p.employee_id)},
          ${p.entry_type},
          ${p.punched_at},
          ${Boolean(p.is_offline_sync)},
          ${p.project_id ? Number(p.project_id) : null},
          ${p.activity_name || "Kerja Reguler"},
          ${matchedLocationId},
          ${typeof p.latitude === "number" ? p.latitude : null},
          ${typeof p.longitude === "number" ? p.longitude : null},
          ${minDistance},
          ${isWithinGeofence},
          ${p.selfie_data || null},
          ${p.notes || ""},
          ${isLate},
          ${lateMinutes},
          'APPROVED'
        )
        ON CONFLICT (client_uuid) DO NOTHING
      `;
      syncedCount++;
    }

    return NextResponse.json({ ok: true, syncedCount });
  } catch (error: any) {
    console.error("Sync Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Gagal menyimpan absensi" },
      { status: 500 }
    );
  }
}
