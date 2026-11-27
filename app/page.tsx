"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Home,
  Clock,
  FileText,
  ShieldCheck,
  Menu,
  ChevronRight,
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
  Users,
  MonitorSmartphone,
  Briefcase,
  CalendarOff,
  Settings,
  ArrowLeft,
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
  });
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatHoursMinutes(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "-";
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  return `${hrs}h ${String(mins).padStart(2, "0")}m`;
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

export default function JibbleDashboardApp() {
  // 5 Navigasi Utama persis seperti Gambar 2
  const [mainTab, setMainTab] = useState<
    "beranda" | "timeclock" | "timesheet" | "persetujuan" | "menu"
  >("beranda");

  // Sub-halaman dari Dasbor & Menu
  const [subView, setSubView] = useState<
    "none" | "whosin" | "kiosk" | "admin" | "leaves"
  >("none");

  // Filter Dasbor (Gambar 2: RENTANG TANGGAL: Hari | LIHAT: Organisasi)
  const [dateRangeMode, setDateRangeMode] = useState<"Hari" | "Minggu">("Hari");
  const [viewScope, setViewScope] = useState<"Organisasi" | "Pribadi">("Organisasi");
  const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false);

  // Status Jaringan & Waktu
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<Date>(new Date());
  const [toast, setToast] = useState<{ type: "ok" | "warn" | "err"; text: string } | null>(null);

  // Data Master & Transaksi
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [serverEntries, setServerEntries] = useState<TimeEntry[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<TimeEntry[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);

  // Pilihan Karyawan Aktif & Proyek
  const [selectedEmpId, setSelectedEmpId] = useState<number>(1);
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1);
  const [selectedActivity, setSelectedActivity] = useState<string>("Kerja Reguler");
  const [punchNotes, setPunchNotes] = useState<string>("");

  // GPS & Kamera Selfie
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>("Mencari titik GPS...");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Kiosk PIN
  const [kioskPin, setKioskPin] = useState<string>("");
  const [kioskEmployee, setKioskEmployee] = useState<Employee | null>(null);

  // Filter Timesheet
  const [filterDate, setFilterDate] = useState<string>(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
  );
  const [filterEmpId, setFilterEmpId] = useState<string>("ALL");

  // Form Admin & Cuti
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
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const handleOnline = () => {
      setIsOnline(true);
      showToast("ok", "Online kembali. Menyinkronkan data ke Neon...");
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast("warn", "Mode Offline aktif. Absensi tersimpan lokal.");
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
      console.error(e);
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
          showToast("ok", `${data.syncedCount} absensi berhasil tersinkron!`);
        }
      } catch (err) {
        console.error(err);
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
      console.warn("Offline cache active");
    }
  }, [syncOfflineQueueToServer]);

  useEffect(() => {
    fetchBootstrapData();
  }, [fetchBootstrapData, isOnline]);

  const refreshGPS = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGpsStatus("GPS tidak didukung");
      return;
    }
    setGpsStatus("Mencari GPS...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus(`Akurasi ±${Math.round(pos.coords.accuracy)}m`);
      },
      (err) => setGpsStatus(`GPS Terbatas (${err.message})`),
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
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraActive(false);
      showToast("warn", "Kamera tidak tersedia, absen tetap bisa dilanjutkan.");
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

  // Hitung durasi kerja & istirahat untuk 1 karyawan pada 1 tanggal tertentu
  const computeDayStats = useCallback(
    (empId: number, targetDateStr: string) => {
      const list = allEntries
        .filter(
          (e) =>
            Number(e.employee_id) === Number(empId) &&
            getJakartaDateStr(e.punched_at) === targetDateStr
        )
        .sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());

      if (list.length === 0) {
        return {
          status: "OUT" as const,
          workSeconds: 0,
          breakSeconds: 0,
          overtimeSeconds: 0,
          entries: [],
        };
      }

      let workSec = 0;
      let breakSec = 0;
      let activeStart: number | null = null;
      let breakStart: number | null = null;

      for (const it of list) {
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

      const last = list[list.length - 1];
      let status: "IN" | "BREAK" | "OUT" = "OUT";
      if (last.entry_type === "CLOCK_IN" || last.entry_type === "BREAK_END") {
        status = "IN";
        if (activeStart !== null && targetDateStr === todayStr) {
          workSec += Math.max(0, (nowTick.getTime() - activeStart) / 1000);
        }
      } else if (last.entry_type === "BREAK_START") {
        status = "BREAK";
        if (breakStart !== null && targetDateStr === todayStr) {
          breakSec += Math.max(0, (nowTick.getTime() - breakStart) / 1000);
        }
      }

      const emp = employees.find((e) => Number(e.id) === Number(empId));
      const targetSec = Number(emp?.work_hours_target || 8) * 3600;
      const overtimeSec = Math.max(0, workSec - targetSec);

      return {
        status,
        workSeconds: Math.floor(workSec),
        breakSeconds: Math.floor(breakSec),
        overtimeSeconds: Math.floor(overtimeSec),
        entries: list,
      };
    },
    [allEntries, todayStr, nowTick, employees]
  );

  const activeEmployee = useMemo(
    () => employees.find((e) => Number(e.id) === Number(selectedEmpId)) || employees[0],
    [employees, selectedEmpId]
  );

  const activeEmpToday = useMemo(
    () => (activeEmployee ? computeDayStats(activeEmployee.id, todayStr) : null),
    [activeEmployee, computeDayStats, todayStr]
  );

  // DATA DASBOR GAMBAR 2: "Siapa yang Masuk/Keluar"
  const whoIsInOutCounts = useMemo(() => {
    const scopeEmps =
      viewScope === "Organisasi"
        ? employees
        : activeEmployee
        ? [activeEmployee]
        : [];
    let masuk = 0;
    let istirahat = 0;
    let keluar = 0;
    for (const emp of scopeEmps) {
      const st = computeDayStats(emp.id, todayStr);
      if (st.status === "IN") masuk++;
      else if (st.status === "BREAK") istirahat++;
      else keluar++;
    }
    return { masuk, istirahat, keluar };
  }, [employees, viewScope, activeEmployee, computeDayStats, todayStr]);

  // DATA DASBOR GAMBAR 2: "Jam terlacak" & Grafik Batang Mingguan (S, S, R, K, J, S, M)
  const weeklyChartData = useMemo(() => {
    const dayLabels = ["S", "S", "R", "K", "J", "S", "M"]; // Senin - Minggu
    // Cari tanggal Senin minggu ini (WIB)
    const jakartaNow = new Date(
      nowTick.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
    );
    const jsDay = jakartaNow.getDay(); // 0=Minggu, 1=Senin..6=Sabtu
    const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
    const monday = new Date(jakartaNow);
    monday.setDate(jakartaNow.getDate() + diffToMonday);

    const scopeEmps =
      viewScope === "Organisasi"
        ? employees
        : activeEmployee
        ? [activeEmployee]
        : [];

    const bars = dayLabels.map((label, idx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + idx);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dStr = `${y}-${m}-${day}`;

      let totalWorkSec = 0;
      let totalBreakSec = 0;
      let totalOtSec = 0;

      for (const emp of scopeEmps) {
        const st = computeDayStats(emp.id, dStr);
        totalWorkSec += st.workSeconds;
        totalBreakSec += st.breakSeconds;
        totalOtSec += st.overtimeSeconds;
      }

      return {
        label,
        dateStr: dStr,
        isToday: dStr === todayStr,
        workSeconds: totalWorkSec,
        breakSeconds: totalBreakSec,
        overtimeSeconds: totalOtSec,
      };
    });

    const todayBar = bars.find((b) => b.isToday) || bars[0];
    const summaryWorkSec =
      dateRangeMode === "Hari"
        ? todayBar.workSeconds
        : bars.reduce((acc, b) => acc + b.workSeconds, 0);
    const summaryBreakSec =
      dateRangeMode === "Hari"
        ? todayBar.breakSeconds
        : bars.reduce((acc, b) => acc + b.breakSeconds, 0);
    const summaryOtSec =
      dateRangeMode === "Hari"
                                            
