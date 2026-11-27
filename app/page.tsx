"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Clock,
  Users,
  FileSpreadsheet,
  CalendarOff,
  Settings,
  MonitorSmartphone,
  Wifi,
  WifiOff,
  RefreshCw,
  MapPin,
  Camera,
  Play,
  Coffee,
  Square,
  AlertTriangle,
  Download,
  Printer,
  Briefcase,
} from "lucide-react";

interface Employee {
  id: number;
  emp_code: string;
  full_name: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  department: string;
  pin_code: string;
  hourly_rate: number;
  shift_id: number | null;
  shift_name?: string;
  start_time?: string;
  end_time?: string;
  grace_minutes?: number;
  work_hours_target?: number;
}

interface LocationItem {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

interface ProjectItem {
  id: number;
  name: string;
  code: string;
  client_name: string;
}

interface ShiftItem {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  work_hours_target: number;
}

interface TimeEntry {
  id?: number;
  client_uuid: string;
  employee_id: number;
  entry_type: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT";
  punched_at: string;
  is_offline_sync?: boolean;
  project_id?: number | null;
  activity_name?: string;
  location_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_meters?: number | null;
  is_within_geofence?: boolean;
  selfie_data?: string | null;
  notes?: string;
  is_late?: boolean;
  late_minutes?: number;
  approval_status?: "PENDING" | "APPROVED" | "REJECTED";
  full_name?: string;
  emp_code?: string;
  department?: string;
  hourly_rate?: number;
  project_name?: string;
  location_name?: string;
}

interface LeaveRequest {
  id: number;
  employee_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  full_name?: string;
  emp_code?: string;
  department?: string;
}

const CACHE_KEY = "jibblepro_master_cache_v2";
const QUEUE_KEY = "jibblepro_offline_queue_v2";
const ACTIVE_EMP_KEY = "jibblepro_active_emp_id_v2";

function getJakartaDateStr(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
}

function formatTimeWIB(isoString?: string | null): string {
  if (!isoString) return "-";
  return new Date(isoString).toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function JibbleProApp() {
  const [activeTab, setActiveTab] = useState<
    "clock" | "live" | "timesheets" | "leaves" | "kiosk" | "admin"
  >("clock");
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<Date>(new Date());
  const [toast, setToast] = useState<{ type: "ok" | "warn" | "err"; text: string } | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [serverEntries, setServerEntries] = useState<TimeEntry[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<TimeEntry[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);

  const [selectedEmpId, setSelectedEmpId] = useState<number>(1);
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1);
  const [selectedActivity, setSelectedActivity] = useState<string>("Kerja Reguler");
  const [punchNotes, setPunchNotes] = useState<string>("");

  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>("Mencari titik GPS...");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [kioskPin, setKioskPin] = useState<string>("");
  const [kioskEmployee, setKioskEmployee] = useState<Employee | null>(null);

  const [filterDate, setFilterDate] = useState<string>(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
  );
  const [filterEmpId, setFilterEmpId] = useState<string>("ALL");

  const [newEmp, setNewEmp] = useState({
    id: 0,
    emp_code: "",
    full_name: "",
    role: "STAFF",
    department: "Operasional",
    pin_code: "1234",
    hourly_rate: "25000",
    shift_id: "1",
  });
  const [newLoc, setNewLoc] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    radius_meters: "150",
  });
  const [newProj, setNewProj] = useState({ name: "", code: "", client_name: "Internal" });
  const [newShift, setNewShift] = useState({
    name: "",
    start_time: "08:00",
    end_time: "17:00",
    grace_minutes: "10",
    work_hours_target: "8",
  });
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "CUTI_TAHUNAN",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const showToast = useCallback((type: "ok" | "warn" | "err", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      showToast("ok", "Koneksi internet tersambung! Menyinkronkan data offline...");
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast("warn", "Mode Offline aktif. Absensi tetap tersimpan di perangkat!");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const timer = setInterval(() => setNowTick(new Date()), 1000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(timer);
    };
  }, [showToast]);

  useEffect(() => {
    try {
      const savedEmp = localStorage.getItem(ACTIVE_EMP_KEY);
      if (savedEmp) setSelectedEmpId(Number(savedEmp));

      const rawQueue = localStorage.getItem(QUEUE_KEY);
      if (rawQueue) setOfflineQueue(JSON.parse(rawQueue));

      const rawCache = localStorage.getItem(CACHE_KEY);
      if (rawCache) {
        const parsed = JSON.parse(rawCache);
        if (parsed.employees) setEmployees(parsed.employees);
        if (parsed.locations) setLocations(parsed.locations);
        if (parsed.projects) setProjects(parsed.projects);
        if (parsed.shifts) setShifts(parsed.shifts);
        if (parsed.entries) setServerEntries(parsed.entries);
        if (parsed.leaves) setLeaves(parsed.leaves);
      }
    } catch (e) {
      console.error("Gagal membaca cache lokal:", e);
    }
  }, []);

  const syncOfflineQueueToServer = useCallback(
    async (queueToSync: TimeEntry[]) => {
      if (!navigator.onLine || queueToSync.length === 0) return;
      setIsSyncing(true);
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ punches: queueToSync }),
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.removeItem(QUEUE_KEY);
          setOfflineQueue([]);
          showToast("ok", `${data.syncedCount} absensi offline berhasil disinkronkan ke Neon!`);
        }
      } catch (err) {
        console.error("Sync gagal, tetap simpan di antrian:", err);
      } finally {
        setIsSyncing(false);
      }
    },
    [showToast]
  );

  const fetchBootstrapData = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const rawQueue = localStorage.getItem(QUEUE_KEY);
      const pending: TimeEntry[] = rawQueue ? JSON.parse(rawQueue) : [];
      if (pending.length > 0) {
        await syncOfflineQueueToServer(pending);
      }

      const res = await fetch("/api/bootstrap", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setEmployees(data.employees || []);
        setLocations(data.locations || []);
        setProjects(data.projects || []);
        setShifts(data.shifts || []);
        setServerEntries(data.entries || []);
        setLeaves(data.leaves || []);

        if (data.employees?.length > 0 && !localStorage.getItem(ACTIVE_EMP_KEY)) {
          setSelectedEmpId(Number(data.employees[0].id));
        }
        if (data.projects?.length > 0) {
          setSelectedProjectId(Number(data.projects[0].id));
        }

        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            employees: data.employees,
            locations: data.locations,
            projects: data.projects,
            shifts: data.shifts,
            entries: data.entries,
            leaves: data.leaves,
          })
        );
      }
    } catch (e) {
      console.warn("Menggunakan cache offline karena server tidak terjangkau.");
    }
  }, [syncOfflineQueueToServer]);

  useEffect(() => {
    fetchBootstrapData();
  }, [fetchBootstrapData, isOnline]);

  const refreshGPS = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGpsStatus("Browser tidak mendukung GPS");
      return;
    }
    setGpsStatus("Memperbarui koordinat GPS...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus(`Akurasi ±${Math.round(pos.coords.accuracy)}m`);
      },
      (err) => {
        setGpsStatus(`GPS Terbatas (${err.message})`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  }, []);

  useEffect(() => {
    refreshGPS();
  }, [refreshGPS]);

  const startCamera = async () => {
    try {
      setCapturedSelfie(null);
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setCameraActive(false);
      showToast("warn", "Kamera tidak diizinkan/tersedia. Absensi tetap bisa dilanjutkan.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return capturedSelfie;
    const canvas = canvasRef.current;
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoRef.current, 0, 0, 240, 240);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
    setCapturedSelfie(dataUrl);
    stopCamera();
    return dataUrl;
  };

  const allEntries: TimeEntry[] = useMemo(() => {
    const serverUuids = new Set(serverEntries.map((e) => e.client_uuid));
    const uniqueOffline = offlineQueue
      .filter((q) => !serverUuids.has(q.client_uuid))
      .map((q) => {
        const emp = employees.find((e) => Number(e.id) === Number(q.employee_id));
        const proj = projects.find((p) => Number(p.id) === Number(q.project_id));
        return {
          ...q,
          full_name: emp?.full_name || "Karyawan",
          emp_code: emp?.emp_code || "-",
          department: emp?.department || "-",
          hourly_rate: emp?.hourly_rate || 25000,
          project_name: proj?.name || "Operasional",
        };
      });
    return [...uniqueOffline, ...serverEntries].sort(
      (a, b) => new Date(b.punched_at).getTime() - new Date(a.punched_at).getTime()
    );
  }, [serverEntries, offlineQueue, employees, projects]);

  const nearestGeofence = useMemo(() => {
    if (!gpsCoords || locations.length === 0) return null;
    let best = locations[0];
    let minD = haversineMeters(
      gpsCoords.lat,
      gpsCoords.lng,
      Number(best.latitude),
      Number(best.longitude)
    );
    for (const loc of locations) {
      const d = haversineMeters(
        gpsCoords.lat,
        gpsCoords.lng,
        Number(loc.latitude),
        Number(loc.longitude)
      );
      if (d < minD) {
        minD = d;
        best = loc;
      }
    }
    return {
      location: best,
      distance: minD,
      inside: minD <= Number(best.radius_meters),
    };
  }, [gpsCoords, locations]);

  const todayStr = getJakartaDateStr(nowTick.toISOString());

  const getEmployeeStatusToday = useCallback(
    (empId: number) => {
      const empToday = allEntries
        .filter(
          (e) =>
            Number(e.employee_id) === Number(empId) &&
            getJakartaDateStr(e.punched_at) === todayStr
        )
        .sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());

      if (empToday.length === 0) {
        return { status: "OUT" as const, workedSeconds: 0, lastEntry: null, entries: [] };
      }

      let workedSec = 0;
      let activeStart: number | null = null;

      for (const item of empToday) {
        const ts = new Date(item.punched_at).getTime();
        if (item.entry_type === "CLOCK_IN" || item.entry_type === "BREAK_END") {
          activeStart = ts;
        } else if (
          (item.entry_type === "BREAK_START" || item.entry_type === "CLOCK_OUT") &&
          activeStart !== null
        ) {
          workedSec += Math.max(0, (ts - activeStart) / 1000);
          activeStart = null;
        }
      }

      const last = empToday[empToday.length - 1];
      let currentStatus: "IN" | "BREAK" | "OUT" = "OUT";
      if (last.entry_type === "CLOCK_IN" || last.entry_type === "BREAK_END") {
        currentStatus = "IN";
        if (activeStart !== null) {
          workedSec += Math.max(0, (nowTick.getTime() - activeStart) / 1000);
        }
      } else if (last.entry_type === "BREAK_START") {
        currentStatus = "BREAK";
      }

      return {
        status: currentStatus,
        workedSeconds: Math.floor(workedSec),
        lastEntry: last,
        entries: empToday,
      };
    },
    [allEntries, todayStr, nowTick]
  );

  const activeEmployee = useMemo(
    () => employees.find((e) => Number(e.id) === Number(selectedEmpId)) || employees[0],
    [employees, selectedEmpId]
  );

  const currentEmpState = useMemo(
    () => (activeEmployee ? getEmployeeStatusToday(activeEmployee.id) : null),
    [activeEmployee, getEmployeeStatusToday]
  );

  const handleRecordPunch = async (
    targetEmpId: number,
    entryType: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT",
    isKiosk = false
  ) => {
    const selfieImg = cameraActive ? capturePhoto() : capturedSelfie;
    const uuid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const punchPayload: TimeEntry = {
      client_uuid: uuid,
      employee_id: Number(targetEmpId),
      entry_type: entryType,
      punched_at: new Date().toISOString(),
      is_offline_sync: !navigator.onLine,
      project_id: selectedProjectId || null,
      activity_name: selectedActivity,
      location_id: nearestGeofence?.location.id || null,
      latitude: gpsCoords?.lat ?? null,
      longitude: gpsCoords?.lng ?? null,
      distance_meters: nearestGeofence?.distance ?? null,
      is_within_geofence: nearestGeofence ? nearestGeofence.inside : true,
      selfie_data: selfieImg || null,
      notes: isKiosk ? `[KIOSK] ${punchNotes}` : punchNotes,
    };

    const updatedQueue = [punchPayload, ...offlineQueue];
    setOfflineQueue(updatedQueue);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updatedQueue));
    setCapturedSelfie(null);
    setPunchNotes("");

    const labelMap = {
      CLOCK_IN: "Clock In (Masuk)",
      BREAK_START: "Mulai Istirahat",
      BREAK_END: "Selesai Istirahat",
      CLOCK_OUT: "Clock Out (Pulang)",
    };

    if (navigator.onLine) {
      await syncOfflineQueueToServer(updatedQueue);
      await fetchBootstrapData();
      showToast("ok", `Berhasil ${labelMap[entryType]} (Tersimpan di Cloud Neon)!`);
    } else {
      showToast(
        "warn",
        `Berhasil ${labelMap[entryType]} [MODE OFFLINE]. Otomatis sinkron saat ada sinyal!`
      );
    }

    if (isKiosk) {
      setKioskPin("");
      setKioskEmployee(null);
    }
  };

  const dailyTimesheets = useMemo(() => {
    const grouped = new Map<string, TimeEntry[]>();
    for (const entry of allEntries) {
      const dStr = getJakartaDateStr(entry.punched_at);
      if (filterDate && dStr !== filterDate) continue;
      if (filterEmpId !== "ALL" && String(entry.employee_id) !== filterEmpId) continue;

      const key = `${entry.employee_id}__${dStr}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
    }

    const rows: any[] = [];
    grouped.forEach((items, key) => {
      const sorted = [...items].sort(
        (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
      );
      const firstIn = sorted.find((i) => i.entry_type === "CLOCK_IN");
      const lastOut = [...sorted].reverse().find((i) => i.entry_type === "CLOCK_OUT");
      const emp = employees.find((e) => Number(e.id) === Number(sorted[0].employee_id));

      let workSec = 0;
      let breakSec = 0;
      let activeStart: number | null = null;
      let breakStart: number | null = null;

      for (const it of sorted) {
        const ts = new Date(it.punched_at).getTime();
        if (it.entry_type === "CLOCK_IN" || it.entry_type === "BREAK_END") {
          if (breakStart !== null) {
            breakSec += Math.max(0, (ts - breakStart) / 1000);
            breakStart = null;
          }
          activeStart = ts;
        } else if (it.entry_type === "BREAK_START") {
          if (activeStart !== null) {
            workSec += Math.max(0, (ts - activeStart) / 1000);
            activeStart = null;
          }
          breakStart = ts;
        } else if (it.entry_type === "CLOCK_OUT") {
          if (activeStart !== null) {
            workSec += Math.max(0, (ts - activeStart) / 1000);
            activeStart = null;
          }
        }
      }

      if (activeStart !== null && getJakartaDateStr(sorted[0].punched_at) === todayStr) {
        workSec += Math.max(0, (nowTick.getTime() - activeStart) / 1000);
      }

      const targetHours = Number(emp?.work_hours_target || 8);
      const totalHours = workSec / 3600;
      const regularHours = Math.min(totalHours, targetHours);
      const overtimeHours = Math.max(0, totalHours - targetHours);
      const rate = Number(emp?.hourly_rate || 25000);
      const estPay = Math.round(regularHours * rate + overtimeHours * rate * 1.5);

      rows.push({
        key,
        dateStr: key.split("__")[1],
        employeeId: sorted[0].employee_id,
        empCode: emp?.emp_code || sorted[0].emp_code || "-",
        fullName: emp?.full_name || sorted[0].full_name || "Karyawan",
        department: emp?.department || sorted[0].department || "-",
        clockIn: firstIn?.punched_at || null,
        clockOut: lastOut?.punched_at || null,
        selfieIn: firstIn?.selfie_data || null,
        locationName: firstIn?.location_name || "-",
        projectName: firstIn?.project_name || "-",
        isLate: Boolean(firstIn?.is_late),
        lateMinutes: Number(firstIn?.late_minutes || 0),
        workSeconds: Math.floor(workSec),
        breakSeconds: Math.floor(breakSec),
        regularHours: regularHours.toFixed(2),
        overtimeHours: overtimeHours.toFixed(2),
        estPay,
        approvalStatus: firstIn?.approval_status || "APPROVED",
        hasOfflinePending: sorted.some((s) => !s.id),
        rawEntries: sorted,
      });
    });

    return rows;
  }, [allEntries, filterDate, filterEmpId, employees, todayStr, nowTick]);

  const exportToExcelOrCsv = (format: "xls" | "csv") => {
    const headers = [
      "Tanggal",
      "ID Karyawan",
      "Nama Karyawan",
      "Departemen",
      "Jam Masuk",
      "Jam Pulang",
      "Durasi Kerja",
      "Istirahat",
      "Jam Reguler",
      "Jam Lembur",
      "Status Telat",
      "Estimasi Gaji (Rp)",
      "Status Approval",
    ];

    const rowsData = dailyTimesheets.map((r) => [
      r.dateStr,
      r.empCode,
      r.fullName,
      r.department,
      formatTimeWIB(r.clockIn),
      formatTimeWIB(r.clockOut),
      formatDuration(r.workSeconds),
      formatDuration(r.breakSeconds),
      r.regularHours,
      r.overtimeHours,
      r.isLate ? `Terlambat ${r.lateMinutes}m` : "Tepat Waktu",
      r.estPay,
      r.approvalStatus,
    ]);

    if (format === "csv") {
      const csvContent =
        "data:text/csv;charset=utf-8," +
        [headers.join(","), ...rowsData.map((e) => e.join(","))].join("\n");
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `Timesheet_JibblePro_${filterDate || "Semua"}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const tableHtml = `
        <table border="1">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${rowsData
            .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>`;
      const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Laporan_Absensi_JibblePro_${filterDate || "Semua"}.xls`;
      a.click();
    }
  };

  const callManageApi = async (action: string, payload: any, successMsg: string) => {
    if (!navigator.onLine) {
      showToast("err", "Pengaturan Admin membutuhkan koneksi internet.");
      return;
    }
    try {
      const res = await fetch("/api/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("ok", successMsg);
        await fetchBootstrapData();
      } else {
        showToast("err", data.error || "Terjadi kesalahan");
      }
    } catch (e: any) {
      showToast("err", e.message || "Gagal menghubungi server");
    }
  };

  const handleKioskPinDigit = (digit: string) => {
    if (kioskPin.length >= 4) return;
    const nextPin = kioskPin + digit;
    setKioskPin(nextPin);
    if (nextPin.length === 4) {
      const found = employees.find((e) => e.pin_code === nextPin);
      if (found) {
        setKioskEmployee(found);
        startCamera();
      } else {
        showToast("err", "PIN Kios tidak ditemukan!");
        setTimeout(() => setKioskPin(""), 600);
      }
    }
  };

  const isAdmin = activeEmployee?.role === "ADMIN" || activeEmployee?.role === "MANAGER";

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-100 text-slate-800">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-white text-sm font-medium flex items-center gap-2 transition-all ${
            toast.type === "ok"
              ? "bg-emerald-600"
              : toast.type === "warn"
              ? "bg-amber-600"
              : "bg-rose-600"
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{toast.text}</span>
        </div>
      )}

      <aside className="hidden md:flex md:w-64 md:flex-col bg-slate-900 text-white p-4 justify-between no-print">
        <div>
          <div className="flex items-center gap-3 px-2 py-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center font-bold text-xl text-white shadow-lg">
              J
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">JibblePro 2</h1>
              <p className="text-xs text-slate-400">Attendance & Timesheets</p>
            </div>
          </div>

          <nav className="mt-6 space-y-1.5">
            {[
              { id: "clock", label: "Time Clock (Absen)", icon: Clock },
              { id: "live", label: "Live Tim (Who's In)", icon: Users },
              { id: "timesheets", label: "Timesheet & Payroll", icon: FileSpreadsheet },
              { id: "leaves", label: "Cuti & Izin", icon: CalendarOff },
              { id: "kiosk", label: "Mode Kios (Shared)", icon: MonitorSmartphone },
              { id: "admin", label: "Pengaturan & Admin", icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    stopCamera();
                    setActiveTab(item.id as any);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                    activeTab === item.id
                      ? "bg-orange-500 text-white shadow"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="bg-slate-800/80 rounded-xl p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Status Jaringan</span>
            <span
              className={`inline-flex items-center gap-1 font-semibold ${
                isOnline ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
          {offlineQueue.length > 0 && (
            <button
              onClick={() => syncOfflineQueueToServer(offlineQueue)}
              disabled={!isOnline || isSyncing}
              className="w-full py-1.5 px-2 rounded-lg bg-amber-500 text-slate-950 font-semibold flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              Sinkronkan ({offlineQueue.length})
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col pb-20 md:pb-6">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-2.5">
            <div className="md:hidden w-8 h-8 rounded-lg bg-orange-500 text-white font-bold flex items-center justify-center">
              J
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {nowTick.toLocaleDateString("id-ID", {
                  timeZone: "Asia/Jakarta",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div className="font-mono font-bold text-base text-slate-900">
                {nowTick.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${
                isOnline
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-800 animate-pulse"
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? "Online" : "Offline"}
            </span>

            {offlineQueue.length > 0 && (
              <button
                onClick={() => syncOfflineQueueToServer(offlineQueue)}
                className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
                Sync ({offlineQueue.length})
              </button>
            )}

            <select
              value={selectedEmpId}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedEmpId(id);
                localStorage.setItem(ACTIVE_EMP_KEY, String(id));
              }}
              className="bg-slate-100 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-800 max-w-[165px] sm:max-w-xs"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.role})
                </option>
              ))}
            </select>
          </div>
        </header>

        {activeTab === "clock" && activeEmployee && currentEmpState && (
          <main className="p-4 max-w-4xl mx-auto w-full space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    {activeEmployee.emp_code} • {activeEmployee.department}
                  </span>
                  <h2 className="text-xl font-bold text-slate-900">
                    {activeEmployee.full_name}
                  </h2>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    currentEmpState.status === "IN"
                      ? "bg-emerald-100 text-emerald-700"
                      : currentEmpState.status === "BREAK"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {currentEmpState.status === "IN"
                    ? "● SEDANG BEKERJA"
                    : currentEmpState.status === "BREAK"
                    ? "● SEDANG ISTIRAHAT"
                    : "○ BELUM MASUK / PULANG"}
                </span>
              </div>

              <div className="my-6 text-center">
                <p className="text-xs text-slate-500 mb-1">Total Durasi Kerja Hari Ini</p>
                <div className="text-4xl sm:text-5xl font-mono font-extrabold tracking-tight text-slate-900">
                  {formatDuration(currentEmpState.workedSeconds)}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Jadwal Shift: {activeEmployee.start_time || "08:00"} -{" "}
                  {activeEmployee.end_time || "17:00"} WIB
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Proyek / Lokasi Tugas
                  </label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.code}] {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Aktivitas Pekerjaan
                  </label>
                  <select
                    value={selectedActivity}
                    onChange={(e) => setSelectedActivity(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="Kerja Reguler">Kerja Reguler</option>
                    <option value="Operasional Lapangan">Operasional Lapangan</option>
                    <option value="Meeting / Koordinasi">Meeting / Koordinasi</option>
                    <option value="Lembur / Tugas Khusus">Lembur / Tugas Khusus</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 flex flex-wrap items-center justify-between gap-2 mb-4 text-xs">
                <div className="flex items-center gap-2">
                  <MapPin
                    className={`w-4 h-4 shrink-0 ${
                      nearestGeofence?.inside ? "text-emerald-600" : "text-amber-600"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-slate-800">
                      {nearestGeofence
                        ? `${nearestGeofence.location.name} (${nearestGeofence.distance}m dari titik)`
                        : gpsStatus}
                    </div>
                    <div className="text-slate-500">
                      {gpsCoords
                        ? `${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)} • ${gpsStatus}`
                        : "Aktifkan izin lokasi browser untuk geofencing"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={refreshGPS}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Perbarui GPS
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-orange-500" />
                    Foto Selfie Bukti Kehadiran
                  </span>
                  {!cameraActive ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="text-xs font-semibold text-orange-600 hover:underline"
                    >
                      {capturedSelfie ? "Ambil Ulang Selfie" : "Buka Kamera Selfie"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="px-3 py-1 rounded-lg bg-orange-500 text-white text-xs font-bold"
                    >
                      Jepret Foto
                    </button>
                  )}
                </div>

                {cameraActive && (
                  <div className="relative w-48 h-48 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-orange-500">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  </div>
                )}

                {capturedSelfie && !cameraActive && (
                  <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-2">
                    <img
                      src={capturedSelfie}
                      alt="Selfie"
                      className="w-12 h-12 rounded-lg object-cover"
                    />
                    <span className="text-xs font-medium text-emerald-800">
                      Foto selfie siap dilampirkan pada absensi.
                    </span>
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              <input
                type="text"
                placeholder="Catatan singkat (opsional, misal: Kunjungan lokasi / WFH)..."
                value={punchNotes}
                onChange={(e) => setPunchNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm mb-4"
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {currentEmpState.status === "OUT" && (
                  <button
                    onClick={() => handleRecordPunch(activeEmployee.id, "CLOCK_IN")}
                    className="sm:col-span-3 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-lg flex items-center justify-center gap-2 transition active:scale-[0.99]"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    CLOCK IN (MASUK KERJA)
                  </button>
                )}

                {currentEmpState.status === "IN" && (
                  <>
                    <button
                      onClick={() => handleRecordPunch(activeEmployee.id, "BREAK_START")}
                      className="py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow flex items-center justify-center gap-2"
                    >
                      <Coffee className="w-5 h-5" />
                      MULAI ISTIRAHAT
                    </button>
                    <button
                      onClick={() => handleRecordPunch(activeEmployee.id, "CLOCK_OUT")}
                      className="sm:col-span-2 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow flex items-center justify-center gap-2"
                    >
                      <Square className="w-5 h-5 fill-current" />
                      CLOCK OUT (PULANG)
                    </button>
                  </>
                )}

                {currentEmpState.status === "BREAK" && (
                  <>
                    <button
                      onClick={() => handleRecordPunch(activeEmployee.id, "BREAK_END")}
                      className="sm:col-span-2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow flex items-center justify-center gap-2"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      SELESAI ISTIRAHAT (LANJUT KERJA)
                    </button>
                    <button
                      onClick={() => handleRecordPunch(activeEmployee.id, "CLOCK_OUT")}
                      className="py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow flex items-center justify-center gap-2"
                    >
                      <Square className="w-5 h-5 fill-current" />
                      PULANG
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
              <h3 className="font-bold text-sm text-slate-800 mb-3">
                Log Aktivitas Anda Hari Ini
              </h3>
              {currentEmpState.entries.length === 0 ? (
                <p className="text-xs text-slate-400">Belum ada catatan absensi hari ini.</p>
              ) : (
                <div className="space-y-2">
                  {currentEmpState.entries.map((item) => (
                    <div
                      key={item.client_uuid}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        {item.selfie_data ? (
                          <img
                            src={item.selfie_data}
                            alt="Bukti"
                            className="w-9 h-9 rounded-lg object-cover border"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center font-bold text-slate-500">
                            {item.entry_type.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-slate-800">
                            {item.entry_type}{" "}
                            {!item.id && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px]">
                                Menunggu Sync
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500">
                            {item.activity_name} • {item.location_name || "GPS"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right font-mono font-bold text-slate-900">
                        {formatTimeWIB(item.punched_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        )}

        {activeTab === "live" && (
          <main className="p-4 max-w-5xl mx-auto w-full space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                Live Monitoring Tim (Real-Time)
              </h2>
              <button
                onClick={fetchBootstrapData}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh Data
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {employees.map((emp) => {
                const st = getEmployeeStatusToday(emp.id);
                const firstIn = st.entries.find((e) => e.entry_type === "CLOCK_IN");
                return (
                  <div
                    key={emp.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        {firstIn?.selfie_data ? (
                          <img
                            src={firstIn.selfie_data}
                            alt={emp.full_name}
                            className="w-12 h-12 rounded-xl object-cover border"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-700 font-bold flex items-center justify-center text-lg">
                            {emp.full_name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-sm text-slate-900">
                            {emp.full_name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {emp.emp_code} • {emp.department}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          st.status === "IN"
                            ? "bg-emerald-100 text-emerald-700"
                            : st.status === "BREAK"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {st.status === "IN"
                          ? "IN"
                          : st.status === "BREAK"
                          ? "ISTIRAHAT"
                          : "OUT"}
                      </span>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Masuk:</span>
                        <span className="font-mono font-semibold">
                          {firstIn ? formatTimeWIB(firstIn.punched_at) : "-"}{" "}
                          {firstIn?.is_late && (
                            <span className="text-rose-600 font-bold">
                              (Telat {firstIn.late_minutes}m)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Durasi Kerja:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {formatDuration(st.workedSeconds)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Lokasi:</span>
                        <span className="truncate max-w-[160px] text-slate-700">
                          {firstIn?.location_name || "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        )}

        {activeTab === "timesheets" && (
          <main className="p-4 max-w-6xl mx-auto w-full space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() => setFilterDate("")}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700"
                >
                  Semua Tanggal
                </button>
                <select
                  value={filterEmpId}
                  onChange={(e) => setFilterEmpId(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="ALL">Semua Karyawan</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportToExcelOrCsv("xls")}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Excel (.xls)
                </button>
                <button
                  onClick={() => exportToExcelOrCsv("csv")}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" /> Cetak / PDF
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Karyawan</th>
                    <th className="p-3">Masuk / Pulang</th>
                    <th className="p-3">Kerja / Istirahat</th>
                    <th className="p-3">Reguler / Lembur</th>
                    <th className="p-3">Estimasi Gaji</th>
                    <th className="p-3">Status & Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {dailyTimesheets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        Tidak ada data timesheet pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    dailyTimesheets.map((row) => (
                      <tr key={row.key} className="hover:bg-slate-50">
                        <td className="p-3 font-mono text-xs">{row.dateStr}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{row.fullName}</div>
                          <div className="text-xs text-slate-500">
                            {row.empCode} • {row.projectName}
                          </div>
                        </td>
                        <td className="p-3 font-mono text-xs">
                          <div>In: {formatTimeWIB(row.clockIn)}</div>
                          <div>Out: {formatTimeWIB(row.clockOut)}</div>
                          {row.isLate && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-sans font-bold text-[10px]">
                              Telat {row.lateMinutes}m
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          <div className="font-bold">{formatDuration(row.workSeconds)}</div>
                          <div className="text-slate-500">
                            Break: {formatDuration(row.breakSeconds)}
                          </div>
                        </td>
                        <td className="p-3 text-xs">
                          <div>Reg: {row.regularHours} jam</div>
                          <div className="text-orange-600 font-semibold">
                            OT: {row.overtimeHours} jam
                          </div>
                        </td>
                        <td className="p-3 font-bold text-emerald-700">
                          Rp {row.estPay.toLocaleString("id-ID")}
                        </td>
                        <td className="p-3 space-y-1 no-print">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              row.approvalStatus === "APPROVED"
                                ? "bg-emerald-100 text-emerald-700"
                                : row.approvalStatus === "REJECTED"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {row.approvalStatus}
                          </span>
                          {isAdmin && (
                            <div className="flex items-center gap-1 pt-1">
                              <button
                                onClick={() =>
                                  callManageApi(
                                    "APPROVE_DATE_ENTRIES",
                                    {
                                      employee_id: row.employeeId,
                                      date_str: row.dateStr,
                                      status: "APPROVED",
                                    },
                                    "Timesheet disetujui!"
                                  )
                                }
                                className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold"
                              >
                                Approve
                              </button>
                              {row.rawEntries[0]?.id && (
                                <button
                                  onClick={() =>
                                    callManageApi(
                                      "DELETE_ENTRY",
                                      { id: row.rawEntries[0].id },
                                      "Log absensi dihapus!"
                                    )
                                  }
                                  className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold"
                                >
                                  Hapus
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </main>
        )}

        {activeTab === "leaves" && (
          <main className="p-4 max-w-4xl mx-auto w-full space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <h2 className="font-bold text-base text-slate-900">
                Ajukan Cuti / Izin / Sakit ({activeEmployee?.full_name})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="CUTI_TAHUNAN">Cuti Tahunan</option>
                  <option value="SAKIT">Sakit</option>
                  <option value="IZIN">Izin Pribadi</option>
                  <option value="DINAS_LUAR">Dinas Luar Kota</option>
                </select>
                <input
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <input
                type="text"
                placeholder="Alasan / keterangan pengajuan..."
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  if (!leaveForm.start_date || !leaveForm.end_date) {
                    showToast("err", "Pilih tanggal mulai dan selesai!");
                    return;
                  }
                  callManageApi(
                    "CREATE_LEAVE",
                    { employee_id: activeEmployee?.id, ...leaveForm },
                    "Pengajuan cuti/izin terkirim!"
                  );
                  setLeaveForm({ ...leaveForm, reason: "" });
                }}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white font-bold text-sm"
              >
                Kirim Pengajuan
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
              <h3 className="font-bold text-sm text-slate-800">Daftar Pengajuan Cuti & Izin</h3>
              {leaves.map((lv) => (
                <div
                  key={lv.id}
                  className="p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">
                      {lv.full_name} — {lv.leave_type}
                    </div>
                    <div className="text-slate-500">
                      {String(lv.start_date).slice(0, 10)} s/d {String(lv.end_date).slice(0, 10)} •{" "}
                      {lv.reason}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold ${
                        lv.status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-700"
                          : lv.status === "REJECTED"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {lv.status}
                    </span>
                    {isAdmin && lv.status === "PENDING" && (
                      <>
                        <button
                          onClick={() =>
                            callManageApi(
                              "UPDATE_LEAVE_STATUS",
                              { id: lv.id, status: "APPROVED" },
                              "Pengajuan disetujui"
                            )
                          }
                          className="px-2 py-1 rounded bg-emerald-600 text-white font-bold"
                        >
                          Setujui
                        </button>
                        <button
                          onClick={() =>
                            callManageApi(
                              "UPDATE_LEAVE_STATUS",
                              { id: lv.id, status: "REJECTED" },
                              "Pengajuan ditolak"
                            )
                          }
                          className="px-2 py-1 rounded bg-rose-600 text-white font-bold"
                        >
                          Tolak
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </main>
        )}

        {activeTab === "kiosk" && (
          <main className="p-4 max-w-md mx-auto w-full">
            <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl text-center space-y-5">
              <div>
                <span className="px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">
                  MODE KIOS ABSENSI BERSAMA
                </span>
                <h2 className="text-xl font-bold mt-2">Masukkan 4-Digit PIN Karyawan</h2>
                <p className="text-xs text-slate-400">
                  Demo PIN: Admin `0000` | Budi `1111` | Siti `2222`
                </p>
              </div>

              {!kioskEmployee ? (
                <>
                  <div className="flex justify-center gap-3 my-4">
                    {[0, 1, 2, 3].map((idx) => (
                      <div
                        key={idx}
                        className="w-12 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl font-bold"
                      >
                        {kioskPin[idx] ? "•" : ""}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(
                      (btn) => (
                        <button
                          key={btn}
                          onClick={() => {
                            if (btn === "C") setKioskPin("");
                            else if (btn === "⌫") setKioskPin((p) => p.slice(0, -1));
                            else handleKioskPinDigit(btn);
                          }}
                          className="h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-orange-500 text-xl font-bold transition"
                        >
                          {btn}
                        </button>
                      )
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="bg-slate-800 p-3 rounded-2xl">
                    <div className="font-bold text-lg text-orange-400">
                      {kioskEmployee.full_name}
                    </div>
                    <div className="text-xs text-slate-300">
                      {kioskEmployee.emp_code} • {kioskEmployee.department}
                    </div>
                  </div>

                  <div className="relative w-44 h-44 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-orange-500">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  </div>
                  <canvas ref={canvasRef} className="hidden" />

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => handleRecordPunch(kioskEmployee.id, "CLOCK_IN", true)}
                      className="py-3 rounded-xl bg-emerald-600 font-bold text-sm"
                    >
                      CLOCK IN
                    </button>
                    <button
                      onClick={() => handleRecordPunch(kioskEmployee.id, "CLOCK_OUT", true)}
                      className="py-3 rounded-xl bg-rose-600 font-bold text-sm"
                    >
                      CLOCK OUT
                    </button>
                    <button
                      onClick={() => handleRecordPunch(kioskEmployee.id, "BREAK_START", true)}
                      className="py-2.5 rounded-xl bg-amber-600 font-bold text-xs"
                    >
                      MULAI ISTIRAHAT
                    </button>
                    <button
                      onClick={() => handleRecordPunch(kioskEmployee.id, "BREAK_END", true)}
                      className="py-2.5 rounded-xl bg-sky-600 font-bold text-xs"
                    >
                      SELESAI ISTIRAHAT
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      stopCamera();
                      setKioskEmployee(null);
                      setKioskPin("");
                    }}
                    className="text-xs text-slate-400 underline"
                  >
                    Batal / Ganti PIN
                  </button>
                </div>
              )}
            </div>
          </main>
        )}

        {activeTab === "admin" && (
          <main className="p-4 max-w-5xl mx-auto w-full space-y-6">
            {!isAdmin && (
              <div className="bg-amber-50 border border-amber-300 text-amber-900 p-4 rounded-2xl text-sm">
                Pilih akun dengan peran <b>ADMIN</b> di menu atas untuk menambah/mengubah data master.
              </div>
            )}

            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
              <h2 className="font-bold text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-500" /> Manajemen Karyawan & PIN Kios
              </h2>

              {isAdmin && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-slate-50 p-3 rounded-xl">
                  <input
                    placeholder="ID (mis: KRY-003)"
                    value={newEmp.emp_code}
                    onChange={(e) => setNewEmp({ ...newEmp, emp_code: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Nama Lengkap"
                    value={newEmp.full_name}
                    onChange={(e) => setNewEmp({ ...newEmp, full_name: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Departemen"
                    value={newEmp.department}
                    onChange={(e) => setNewEmp({ ...newEmp, department: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    placeholder="PIN Kios (4 digit)"
                    maxLength={4}
                    value={newEmp.pin_code}
                    onChange={(e) => setNewEmp({ ...newEmp, pin_code: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <select
                    value={newEmp.role}
                    onChange={(e) => setNewEmp({ ...newEmp, role: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  >
                    <option value="STAFF">STAFF</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Tarif per Jam (Rp)"
                    value={newEmp.hourly_rate}
                    onChange={(e) => setNewEmp({ ...newEmp, hourly_rate: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <select
                    value={newEmp.shift_id}
                    onChange={(e) => setNewEmp({ ...newEmp, shift_id: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  >
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.start_time})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (!newEmp.emp_code || !newEmp.full_name) {
                        showToast("err", "ID dan Nama wajib diisi!");
                        return;
                      }
                      callManageApi("SAVE_EMPLOYEE", newEmp, "Data karyawan tersimpan!");
                      setNewEmp({
                        id: 0,
                        emp_code: "",
                        full_name: "",
                        role: "STAFF",
                        department: "Operasional",
                        pin_code: "1234",
                        hourly_rate: "25000",
                        shift_id: "1",
                      });
                    }}
                    className="rounded-lg bg-orange-500 text-white font-bold text-sm py-1.5"
                  >
                    {newEmp.id ? "Update Karyawan" : "+ Tambah Karyawan"}
                  </button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-2">ID</th>
                      <th className="p-2">Nama</th>
                      <th className="p-2">Role / Dept</th>
                      <th className="p-2">PIN Kios</th>
                      <th className="p-2">Tarif/Jam</th>
                      {isAdmin && <th className="p-2">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employees.map((e) => (
                      <tr key={e.id}>
                        <td className="p-2 font-mono">{e.emp_code}</td>
                        <td className="p-2 font-bold">{e.full_name}</td>
                        <td className="p-2">
                          {e.role} • {e.department}
                        </td>
                        <td className="p-2 font-mono">{e.pin_code}</td>
                        <td className="p-2">Rp {Number(e.hourly_rate).toLocaleString("id-ID")}</td>
                        {isAdmin && (
                          <td className="p-2 flex gap-2">
                            <button
                              onClick={() =>
                                setNewEmp({
                                  id: e.id,
                                  emp_code: e.emp_code,
                                  full_name: e.full_name,
                                  role: e.role,
                                  department: e.department,
                                  pin_code: e.pin_code,
                                  hourly_rate: String(e.hourly_rate),
                                  shift_id: String(e.shift_id || 1),
                                })
                              }
                              className="text-sky-600 font-bold"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                callManageApi(
                                  "DELETE_EMPLOYEE",
                                  { id: e.id },
                                  "Karyawan dinonaktifkan"
                                )
                              }
                              className="text-rose-600 font-bold"
                            >
                              Hapus
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600" /> Lokasi Kantor & Radius Geofence
                </h2>
                {gpsCoords && isAdmin && (
                  <button
                    onClick={() =>
                      setNewLoc({
                        ...newLoc,
                        latitude: String(gpsCoords.lat),
                        longitude: String(gpsCoords.lng),
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold"
                  >
                    Gunakan Koordinat GPS Saya Saat Ini
                  </button>
                )}
              </div>

              {isAdmin && (
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 bg-slate-50 p-3 rounded-xl">
                  <input
                    placeholder="Nama Lokasi"
                    value={newLoc.name}
                    onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Latitude (-6.xxx)"
                    value={newLoc.latitude}
                    onChange={(e) => setNewLoc({ ...newLoc, latitude: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Longitude (110.xxx)"
                    value={newLoc.longitude}
                    onChange={(e) => setNewLoc({ ...newLoc, longitude: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Radius (meter)"
                    value={newLoc.radius_meters}
                    onChange={(e) => setNewLoc({ ...newLoc, radius_meters: e.target.value })}
                    className="rounded-lg border px-2.5 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => {
                      if (!newLoc.name || !newLoc.latitude || !newLoc.longitude) return;
                      callManageApi("SAVE_LOCATION", newLoc, "Lokasi geofence ditambahkan!");
                      setNewLoc({
                        name: "",
                        address: "",
                        latitude: "",
                        longitude: "",
                        radius_meters: "150",
                      });
                    }}
                    className="rounded-lg bg-emerald-600 text-white font-bold text-sm py-1.5"
                  >
                    + Simpan Lokasi
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {locations.map((loc) => (
                  <div
                    key={loc.id}
                    className="p-3 rounded-xl border flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{loc.name}</div>
                      <div className="text-slate-500 font-mono">
                        {loc.latitude}, {loc.longitude} • Radius {loc.radius_meters}m
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() =>
                          callManageApi("DELETE_LOCATION", { id: loc.id }, "Lokasi dihapus")
                        }
                        className="text-rose-600 font-bold"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-orange-500" /> Daftar Proyek
                </h3>
                {isAdmin && (
                  <div className="flex gap-2">
                    <input
                      placeholder="Kode"
                      value={newProj.code}
                      onChange={(e) => setNewProj({ ...newProj, code: e.target.value })}
                      className="w-24 rounded-lg border px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Nama Proyek"
                      value={newProj.name}
                      onChange={(e) => setNewProj({ ...newProj, name: e.target.value })}
                      className="flex-1 rounded-lg border px-2 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => {
                        if (!newProj.name || !newProj.code) return;
                        callManageApi("SAVE_PROJECT", newProj, "Proyek ditambahkan!");
                        setNewProj({ name: "", code: "", client_name: "Internal" });
                      }}
                      className="px-3 rounded-lg bg-slate-900 text-white text-xs font-bold"
                    >
                      +
                    </button>
                  </div>
                )}
                <div className="space-y-1.5 text-xs">
                  {projects.map((p) => (
                    <div key={p.id} className="p-2 rounded-lg bg-slate-50 flex justify-between">
                      <span>
                        <b>[{p.code}]</b> {p.name}
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() =>
                            callManageApi("DELETE_PROJECT", { id: p.id }, "Proyek dihapus")
                          }
                          className="text-rose-600"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-600" /> Jadwal Shift & Toleransi Telat
                </h3>
                {isAdmin && (
                  <div className="grid grid-cols-4 gap-1.5">
                    <input
                      placeholder="Nama Shift"
                      value={newShift.name}
                      onChange={(e) => setNewShift({ ...newShift, name: e.target.value })}
                      className="col-span-2 rounded-lg border px-2 py-1.5 text-xs"
                    />
                    <input
                      type="time"
                      value={newShift.start_time}
                      onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                      className="rounded-lg border px-2 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => {
                        if (!newShift.name) return;
                        callManageApi("SAVE_SHIFT", newShift, "Shift baru disimpan!");
                        setNewShift({
                          name: "",
                          start_time: "08:00",
                          end_time: "17:00",
                          grace_minutes: "10",
                          work_hours_target: "8",
                        });
                      }}
                      className="rounded-lg bg-sky-600 text-white text-xs font-bold"
                    >
                      + Shift
                    </button>
                  </div>
                )}
                <div className="space-y-1.5 text-xs">
                  {shifts.map((s) => (
                    <div key={s.id} className="p-2 rounded-lg bg-slate-50 flex justify-between">
                      <span className="font-semibold">{s.name}</span>
                      <span className="font-mono">
                        {s.start_time} - {s.end_time} (Telat &gt;{s.grace_minutes}m)
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </main>
        )}
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex justify-around py-1.5 z-40 no-print">
        {[
          { id: "clock", label: "Absen", icon: Clock },
          { id: "live", label: "Live Tim", icon: Users },
          { id: "timesheets", label: "Rekap", icon: FileSpreadsheet },
          { id: "kiosk", label: "Kios", icon: MonitorSmartphone },
          { id: "leaves", label: "Cuti", icon: CalendarOff },
          { id: "admin", label: "Admin", icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                stopCamera();
                setActiveTab(tab.id as any);
              }}
              className={`flex flex-col items-center px-2 py-1 rounded-lg text-[10px] font-semibold ${
                active ? "text-orange-600" : "text-slate-500"
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${active ? "text-orange-500" : ""}`} />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
