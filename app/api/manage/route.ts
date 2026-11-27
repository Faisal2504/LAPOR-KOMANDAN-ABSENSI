import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, payload } = body;

    switch (action) {
      case "SAVE_EMPLOYEE": {
        if (payload.id) {
          await sql`
            UPDATE employees SET
              emp_code = ${payload.emp_code},
              full_name = ${payload.full_name},
              role = ${payload.role || "STAFF"},
              department = ${payload.department || "Operasional"},
              pin_code = ${payload.pin_code || "1234"},
              hourly_rate = ${Number(payload.hourly_rate || 25000)},
              shift_id = ${payload.shift_id ? Number(payload.shift_id) : null}
            WHERE id = ${Number(payload.id)}
          `;
        } else {
          await sql`
            INSERT INTO employees (emp_code, full_name, role, department, pin_code, hourly_rate, shift_id)
            VALUES (
              ${payload.emp_code},
              ${payload.full_name},
              ${payload.role || "STAFF"},
              ${payload.department || "Operasional"},
              ${payload.pin_code || "1234"},
              ${Number(payload.hourly_rate || 25000)},
              ${payload.shift_id ? Number(payload.shift_id) : null}
            )
          `;
        }
        break;
      }

      case "DELETE_EMPLOYEE": {
        await sql`UPDATE employees SET is_active = FALSE WHERE id = ${Number(payload.id)}`;
        break;
      }

      case "SAVE_LOCATION": {
        if (payload.id) {
          await sql`
            UPDATE locations SET
              name = ${payload.name},
              address = ${payload.address || ""},
              latitude = ${Number(payload.latitude)},
              longitude = ${Number(payload.longitude)},
              radius_meters = ${Number(payload.radius_meters || 150)}
            WHERE id = ${Number(payload.id)}
          `;
        } else {
          await sql`
            INSERT INTO locations (name, address, latitude, longitude, radius_meters)
            VALUES (
              ${payload.name},
              ${payload.address || ""},
              ${Number(payload.latitude)},
              ${Number(payload.longitude)},
              ${Number(payload.radius_meters || 150)}
            )
          `;
        }
        break;
      }

      case "DELETE_LOCATION": {
        await sql`DELETE FROM locations WHERE id = ${Number(payload.id)}`;
        break;
      }

      case "SAVE_PROJECT": {
        await sql`
          INSERT INTO projects (name, code, client_name)
          VALUES (${payload.name}, ${payload.code}, ${payload.client_name || "Internal"})
        `;
        break;
      }

      case "DELETE_PROJECT": {
        await sql`UPDATE projects SET is_active = FALSE WHERE id = ${Number(payload.id)}`;
        break;
      }

      case "SAVE_SHIFT": {
        await sql`
          INSERT INTO shifts (name, start_time, end_time, grace_minutes, work_hours_target)
          VALUES (
            ${payload.name},
            ${payload.start_time || "08:00"},
            ${payload.end_time || "17:00"},
            ${Number(payload.grace_minutes || 10)},
            ${Number(payload.work_hours_target || 8)}
          )
        `;
        break;
      }

      case "UPDATE_ENTRY": {
        await sql`
          UPDATE time_entries SET
            punched_at = ${payload.punched_at},
            entry_type = ${payload.entry_type},
            approval_status = ${payload.approval_status || "APPROVED"},
            notes = ${payload.notes || ""}
          WHERE id = ${Number(payload.id)}
        `;
        break;
      }

      case "APPROVE_DATE_ENTRIES": {
        await sql`
          UPDATE time_entries
          SET approval_status = ${payload.status}
          WHERE employee_id = ${Number(payload.employee_id)}
            AND DATE(punched_at AT TIME ZONE 'Asia/Jakarta') = ${payload.date_str}
        `;
        break;
      }

      case "DELETE_ENTRY": {
        await sql`DELETE FROM time_entries WHERE id = ${Number(payload.id)}`;
        break;
      }

      case "CREATE_LEAVE": {
        await sql`
          INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason)
          VALUES (
            ${Number(payload.employee_id)},
            ${payload.leave_type},
            ${payload.start_date},
            ${payload.end_date},
            ${payload.reason || ""}
          )
        `;
        break;
      }

      case "UPDATE_LEAVE_STATUS": {
        await sql`
          UPDATE leave_requests SET status = ${payload.status}
          WHERE id = ${Number(payload.id)}
        `;
        break;
      }

      default:
        return NextResponse.json({ ok: false, error: "Aksi tidak dikenal" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Manage Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Gagal memproses perubahan" },
      { status: 500 }
    );
  }
}
