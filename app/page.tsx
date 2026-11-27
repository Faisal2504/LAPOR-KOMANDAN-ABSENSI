"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Home,
  Clock,
  FileText,
  ShieldCheck,
  Menu,
  ChevronRight,
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
  Settings,
  ArrowLeft,
  QrCode,
  Upload,
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
  work_hours_target?: number;
  shift_name?: string;
  shift_start_time?: string;
}

interface ShiftPreset {
  id: number;
  name: string;
  startTime: string;
  targetHours: number;
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
}

interface TimesheetRow {
  key: string;
  dateStr: string;
  empCode: string;
  fullName: string;
  clockIn: string | null;
  clockOut: string | null;
  projectName: string;
  isLate: boolean;
  lateMinutes: number;
  workSeconds: number;
  breakSeconds: number;
  overtimeHours: string;
  estPay: number;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
}

interface ImportedEmployeeScheduleRow {
  emp_code: string;
  full_name: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  department: string;
  pin_code: string;
  hourly_rate: number;
  shift_id: number;
  shift_name: string;
  shift_start_time: string;
  schedule_date?: string;
}

type MainTab = "beranda" | "timeclock" | "timesheet" | "persetujuan" | "menu";
type SubView = "none" | "whosin" | "kiosk" | "admin";

const SHIFT_PRESETS: ShiftPreset[] = [
  { id: 1, name: "Shift Pagi", startTime: "07:00", targetHours: 8 },
  { id: 2, name: "Shift Siang", startTime: "15:00", targetHours: 8 },
  { id: 3, name: "Shift Malam", startTime: "23:00", targetHours: 8 },
];

const CACHE_KEY = "jibblepro_master_cache_v2";
const QUEUE_KEY = "jibblepro_offline_queue_v2";
const ACTIVE_EMP_KEY = "jibblepro_active_emp_id_v2";
const QR_CODE_KEY = "jibblepro_office_qr_v2";
const SHIFT_ASSIGN_KEY = "jibblepro_shift_assignments_v1";

const getJakartaDateStr = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const formatTimeWIB = (iso?: string | null) =>
  !iso
    ? "-"
    : new Date(iso).toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
      });

const formatDuration = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const formatHM = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return "-";
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function resolveShiftPreset(input?: string | number | null): ShiftPreset {
  if (typeof input === "number") {
    return SHIFT_PRESETS.find((s) => s.id === input) || SHIFT_PRESETS[0];
  }
  const raw = String(input || "").trim().toLowerCase();
  if (
    raw === "2" ||
    raw.includes("siang") ||
    raw.includes("15:00") ||
    raw.includes("15.00")
  ) {
    return SHIFT_PRESETS[1];
  }
  if (
    raw === "3" ||
    raw.includes("malam") ||
    raw.includes("23:00") ||
    raw.includes("23.00")
  ) {
    return SHIFT_PRESETS[2];
  }
  return SHIFT_PRESETS[0];
}

function calcLateFromShift(punchedIso: string, shiftStartTime: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(punchedIso))
    .split(":");
  const actualMin = Number(parts[0]) * 60 + Number(parts[1]);
  const normStart = shiftStartTime.replace(".", ":");
  const [sh, sm] = normStart.split(":").map(Number);
  const startMin = (isNaN(sh) ? 7 : sh) * 60 + (isNaN(sm) ? 0 : sm);
  const diff = actualMin - startMin;
  if (diff > 0) {
    return { isLate: true, lateMinutes: diff };
  }
  return { isLate: false, lateMinutes: 0 };
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseDelimitedTextToItems(text: string): ImportedEmployeeScheduleRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9_]/g, "_")
  );
  const hasHeader = headers.some((h) =>
    ["nama", "full_name", "emp_code", "id_karyawan", "shift", "pin"].includes(h)
  );

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: ImportedEmployeeScheduleRow[] = [];

  dataLines.forEach((line, idx) => {
    const cols = splitCsvLine(line, delimiter);
    const map: Record<string, string> = {};
    if (hasHeader) {
      headers.forEach((h, i) => {
        if (h) map[h] = cols[i] ?? "";
      });
    } else {
      map.emp_code = cols[0] ?? "";
      map.full_name = cols[1] ?? "";
      map.shift = cols[2] ?? "1";
      map.department = cols[3] ?? "Operasional";
      map.pin_code = cols[4] ?? "1234";
    }

    const fullName =
      map.full_name || map.nama_lengkap || map.nama || map.karyawan || "";
    const empCode =
      map.emp_code ||
      map.id_karyawan ||
      map.nip ||
      map.kode ||
      (fullName ? `KRY-${String(idx + 1).padStart(3, "0")}` : "");
    if (!fullName && !empCode) return;

    const shiftRaw =
      map.shift ||
      map.shift_name ||
      map.jadwal ||
      map.shift_id ||
      map.jam_masuk ||
      line;
    const preset = resolveShiftPreset(shiftRaw);

    const roleRaw = (map.role || map.jabatan || "STAFF").toUpperCase();
    const role: "ADMIN" | "MANAGER" | "STAFF" = roleRaw.includes("ADMIN")
      ? "ADMIN"
      : roleRaw.includes("MAN")
      ? "MANAGER"
      : "STAFF";

    const pinRaw = (map.pin_code || map.pin || "1234")
      .replace(/\D/g, "")
      .slice(0, 4);
    const rateRaw = Number(
      (map.hourly_rate || map.upah || "25000").replace(/\D/g, "")
    );

    rows.push({
      emp_code: empCode,
      full_name: fullName || empCode,
      role,
      department: map.department || map.departemen || "Operasional",
      pin_code: pinRaw.length === 4 ? pinRaw : "1234",
      hourly_rate: rateRaw > 0 ? rateRaw : 25000,
      shift_id: preset.id,
      shift_name: preset.name,
      shift_start_time: preset.startTime,
      schedule_date: map.tanggal || map.date || undefined,
    });
  });

  return rows;
}

function parsePdfLinesToImportItems(lines: string[]): ImportedEmployeeScheduleRow[] {
  const items: ImportedEmployeeScheduleRow[] = [];
  lines.forEach((line, idx) => {
    const clean = line.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (
      lower.startsWith("jadwal") ||
      lower.startsWith("daftar") ||
      (lower.includes("nama") && lower.includes("shift"))
    ) {
      return;
    }

    const codeMatch = clean.match(/\b([A-Z]{2,5}[-_]\d{2,5})\b/i);
    const preset = resolveShiftPreset(clean);
    const dateMatch = clean.match(
      /\b(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/
    );

    let namePart = clean;
    if (codeMatch) namePart = namePart.replace(codeMatch[0], " ");
    namePart = namePart
      .replace(/shift\s*(pagi|siang|malam|1|2|3)/gi, " ")
      .replace(/\b(07[:.]00|15[:.]00|23[:.]00)\b/g, " ")
      .replace(/\b(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/g, " ")
      .replace(/[|•–—-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!namePart && !codeMatch) return;

    items.push({
      emp_code: codeMatch
        ? codeMatch[1].toUpperCase()
        : `PDF-${String(idx + 1).padStart(3, "0")}`,
      full_name: namePart || `Karyawan ${idx + 1}`,
      role: "STAFF",
      department: "Operasional",
      pin_code: "1234",
      hourly_rate: 25000,
      shift_id: preset.id,
      shift_name: preset.name,
      shift_start_time: preset.startTime,
      schedule_date: dateMatch ? dateMatch[1] : undefined,
    });
  });
  return items;
}

function extractReadableLinesFromPdfBytes(bytes: Uint8Array): string[] {
  const raw = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  const parenMatches = raw.match(/\(([^()\\]{2,120})\)/g) || [];
  for (const m of parenMatches) {
    const inner = m
      .slice(1, -1)
      .replace(/\\([()\\])/g, "$1")
      .replace(/[^\x20-\x7E]/g, " ")
      .trim();
    if (inner.length >= 2 && /[a-zA-Z0-9]/.test(inner)) {
      chunks.push(inner);
    }
  }
  return chunks;
}

export default function JibbleDashboardApp() {
  const [mainTab, setMainTab] = useState<MainTab>("beranda");
  const [subView, setSubView] = useState<SubView>("none");
  const [dateRangeMode, setDateRangeMode] = useState<"Hari" | "Minggu">("Hari");
  const [viewScope, setViewScope] = useState<"Organisasi" | "Pribadi">("Organisasi");
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [toast, setToast] = useState<{
    type: "ok" | "warn" | "err";
    text: string;
  } | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [serverEntries, setServerEntries] = useState<TimeEntry[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<TimeEntry[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [shiftMap, setShiftMap] = useState<Record<number, number>>({});

  const [selectedEmpId, setSelectedEmpId] = useState<number>(1);
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1);
  const [selectedActivity, setSelectedActivity] = useState("Kerja Reguler");
  const [punchNotes, setPunchNotes] = useState("");

  const [officeQrCode, setOfficeQrCode] = useState("ABSENSI-KANTOR-MPI-BTG");
  const [qrInput, setQrInput] = useState("");
  const [qrScanActive, setQrScanActive] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);

  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [gpsStatus, setGpsStatus] = useState("Mencari titik GPS...");
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [kioskPin, setKioskPin] = useState("");
  const [kioskEmployee, setKioskEmployee] = useState<Employee | null>(null);

  const [filterDate, setFilterDate] = useState(() =>
    getJakartaDateStr(new Date().toISOString())
  );
  const [filterEmpId, setFilterEmpId] = useState("ALL");

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
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "CUTI_TAHUNAN",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const [importRows, setImportRows] = useState<ImportedEmployeeScheduleRow[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback(
    (type: "ok" | "warn" | "err", text: string) => {
      setToast({ type, text });
      setTimeout(() => setToast(null), 3500);
    },
    []
  );

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onOnline = () => {
      setIsOnline(true);
      showToast("ok", "Online kembali. Menyinkronkan data...");
    };
    const onOffline = () => {
      setIsOnline(false);
      showToast("warn", "Mode Offline aktif. Tersimpan di HP.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(() => setNowTick(new Date()), 1000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
  }, [showToast]);

  useEffect(() => {
    try {
      const savedQr = localStorage.getItem(QR_CODE_KEY);
      if (savedQr) setOfficeQrCode(savedQr);
      const savedShifts = localStorage.getItem(SHIFT_ASSIGN_KEY);
      if (savedShifts) setShiftMap(JSON.parse(savedShifts));
      const savedEmp = localStorage.getItem(ACTIVE_EMP_KEY);
      if (savedEmp) setSelectedEmpId(Number(savedEmp));
      const rawQ = localStorage.getItem(QUEUE_KEY);
      if (rawQ) setOfflineQueue(JSON.parse(rawQ));
      const rawC = localStorage.getItem(CACHE_KEY);
      if (rawC) {
        const p = JSON.parse(rawC);
        if (p.employees) setEmployees(p.employees);
        if (p.locations) setLocations(p.locations);
        if (p.projects) setProjects(p.projects);
        if (p.entries) setServerEntries(p.entries);
        if (p.leaves) setLeaves(p.leaves);
      }
    } catch {
      // Abaikan error storage lokal
    }
  }, []);

  const syncOfflineQueueToServer = useCallback(
    async (queue: TimeEntry[]) => {
      if (!navigator.onLine || queue.length === 0) return;
      setIsSyncing(true);
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ punches: queue }),
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.removeItem(QUEUE_KEY);
          setOfflineQueue([]);
          showToast("ok", `${data.syncedCount} data berhasil tersinkron!`);
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [showToast]
  );

  const fetchBootstrapData = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const rawQ = localStorage.getItem(QUEUE_KEY);
      const pending: TimeEntry[] = rawQ ? JSON.parse(rawQ) : [];
      if (pending.length > 0) await syncOfflineQueueToServer(pending);
      const res = await fetch("/api/bootstrap", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setEmployees(data.employees || []);
        setLocations(data.locations || []);
        setProjects(data.projects || []);
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
            entries: data.entries,
            leaves: data.leaves,
          })
        );
      }
    } catch {
      // Abaikan error jaringan sementara
    }
  }, [syncOfflineQueueToServer]);

  useEffect(() => {
    fetchBootstrapData();
  }, [fetchBootstrapData, isOnline]);

  const enrichedEmployees = useMemo<Employee[]>(() => {
    return employees.map((emp) => {
      const assignedShiftId = shiftMap[emp.id] ?? emp.shift_id ?? 1;
      const preset = resolveShiftPreset(assignedShiftId);
      return {
        ...emp,
        shift_id: preset.id,
        shift_name: preset.name,
        shift_start_time: preset.startTime,
        work_hours_target: emp.work_hours_target || preset.targetHours,
      };
    });
  }, [employees, shiftMap]);

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

  const stopQrScanner = useCallback(() => {
    if (qrVideoRef.current?.srcObject) {
      (qrVideoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((t) => t.stop());
      qrVideoRef.current.srcObject = null;
    }
    setQrScanActive(false);
  }, []);

  const startQrScanner = async () => {
    try {
      setQrScanActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (qrVideoRef.current) qrVideoRef.current.srcObject = stream;
      const BD = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      if (BD) {
        const detector = new BD({ formats: ["qr_code"] });
        const tick = async () => {
          if (!qrVideoRef.current || !qrVideoRef.current.srcObject) return;
          try {
            const codes = await detector.detect(qrVideoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              setQrInput(codes[0].rawValue);
              stopQrScanner();
              showToast("ok", "QR Kantor terbaca! Silakan tekan tombol absen.");
              return;
            }
          } catch {
            // Lanjutkan frame berikutnya
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    } catch {
      setQrScanActive(false);
      showToast("warn", "Kamera QR diblokir, silakan ketik kode QR manual.");
    }
  };

  const startCamera = async () => {
    try {
      setCapturedSelfie(null);
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 480 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraActive(false);
      showToast("warn", "Kamera tidak tersedia, absen tetap bisa dilanjutkan.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return capturedSelfie;
    const c = canvasRef.current;
    c.width = 240;
    c.height = 240;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoRef.current, 0, 0, 240, 240);
    const url = c.toDataURL("image/jpeg", 0.65);
    setCapturedSelfie(url);
    stopCamera();
    return url;
  };

  const allEntries = useMemo(() => {
    const ids = new Set(serverEntries.map((e) => e.client_uuid));
    const localOnly = offlineQueue
      .filter((q) => !ids.has(q.client_uuid))
      .map((q) => {
        const emp = enrichedEmployees.find(
          (e) => Number(e.id) === Number(q.employee_id)
        );
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
    return [...localOnly, ...serverEntries].sort(
      (a, b) => new Date(b.punched_at).getTime() - new Date(a.punched_at).getTime()
    );
  }, [serverEntries, offlineQueue, enrichedEmployees, projects]);

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

  const computeDayStats = useCallback(
    (empId: number, targetDate: string) => {
      const list = allEntries
        .filter(
          (e) =>
            Number(e.employee_id) === Number(empId) &&
            getJakartaDateStr(e.punched_at) === targetDate
        )
        .sort(
          (a, b) =>
            new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
        );
      if (list.length === 0) {
        return {
          status: "OUT" as const,
          workSeconds: 0,
          breakSeconds: 0,
          overtimeSeconds: 0,
          entries: [] as TimeEntry[],
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
        if (activeStart !== null && targetDate === todayStr) {
          workSec += Math.max(0, (nowTick.getTime() - activeStart) / 1000);
        }
      } else if (last.entry_type === "BREAK_START") {
        status = "BREAK";
        if (breakStart !== null && targetDate === todayStr) {
          breakSec += Math.max(0, (nowTick.getTime() - breakStart) / 1000);
        }
      }

      const emp = enrichedEmployees.find((e) => Number(e.id) === Number(empId));
      const targetSec = Number(emp?.work_hours_target || 8) * 3600;
      return {
        status,
        workSeconds: Math.floor(workSec),
        breakSeconds: Math.floor(breakSec),
        overtimeSeconds: Math.floor(Math.max(0, workSec - targetSec)),
        entries: list,
      };
    },
    [allEntries, todayStr, nowTick, enrichedEmployees]
  );

  const activeEmployee = useMemo(
    () =>
      enrichedEmployees.find((e) => Number(e.id) === Number(selectedEmpId)) ||
      enrichedEmployees[0],
    [enrichedEmployees, selectedEmpId]
  );

  const isAdmin =
    activeEmployee?.role === "ADMIN" || activeEmployee?.role === "MANAGER";

  const settings = useMemo(
    () => ({
      office_name:
        nearestGeofence?.location.name ||
        locations[0]?.name ||
        "Kantor Utama MPI-BTG",
      qr_code: officeQrCode,
      radius_meters:
        nearestGeofence?.location.radius_meters ||
        locations[0]?.radius_meters ||
        150,
    }),
    [nearestGeofence, locations, officeQrCode]
  );

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    settings.qr_code
  )}`;

  const activeEmpToday = useMemo(
    () => (activeEmployee ? computeDayStats(activeEmployee.id, todayStr) : null),
    [activeEmployee, computeDayStats, todayStr]
  );

  const whoIsInOutCounts = useMemo(() => {
    const scopeEmps =
      viewScope === "Organisasi"
        ? enrichedEmployees
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
  }, [enrichedEmployees, viewScope, activeEmployee, computeDayStats, todayStr]);

  const weeklyChartData = useMemo(() => {
    const dayLabels = ["S", "S", "R", "K", "J", "S", "M"];
    const jNow = new Date(
      nowTick.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
    );
    const jsDay = jNow.getDay();
    const monday = new Date(jNow);
    monday.setDate(jNow.getDate() + (jsDay === 0 ? -6 : 1 - jsDay));
    const scopeEmps =
      viewScope === "Organisasi"
        ? enrichedEmployees
        : activeEmployee
        ? [activeEmployee]
        : [];

    const bars = dayLabels.map((label, idx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + idx);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;
      let w = 0;
      let b = 0;
      let o = 0;
      for (const emp of scopeEmps) {
        const st = computeDayStats(emp.id, dStr);
        w += st.workSeconds;
        b += st.breakSeconds;
        o += st.overtimeSeconds;
      }
      return {
        label,
        dateStr: dStr,
        isToday: dStr === todayStr,
        workSeconds: w,
        breakSeconds: b,
        overtimeSeconds: o,
      };
    });

    const todayBar = bars.find((b) => b.isToday) || bars[0];
    const summaryWorkSec =
      dateRangeMode === "Hari"
        ? todayBar.workSeconds
        : bars.reduce((a, b) => a + b.workSeconds, 0);
    const summaryBreakSec =
      dateRangeMode === "Hari"
        ? todayBar.breakSeconds
        : bars.reduce((a, b) => a + b.breakSeconds, 0);
    const summaryOtSec =
      dateRangeMode === "Hari"
        ? todayBar.overtimeSeconds
        : bars.reduce((a, b) => a + b.overtimeSeconds, 0);
    const maxH = Math.max(...bars.map((b) => b.workSeconds / 3600), 0);
    const axisMax = maxH <= 18 ? 18 : Math.ceil(maxH / 6) * 6;
    const step = axisMax / 6;
    return {
      bars,
      summaryWorkSec,
      summaryBreakSec,
      summaryOtSec,
      axisMax,
      ticks: [0, step, step * 2, step * 3, step * 4, step * 5, axisMax],
    };
  }, [
    nowTick,
    viewScope,
    enrichedEmployees,
    activeEmployee,
    computeDayStats,
    todayStr,
    dateRangeMode,
  ]);

  const handleRecordPunch = async (
    targetEmpId: number,
    entryType: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT",
    isKiosk = false
  ) => {
    const targetEmp = enrichedEmployees.find(
      (e) => Number(e.id) === Number(targetEmpId)
    );
    const targetIsAdmin =
      targetEmp?.role === "ADMIN" || targetEmp?.role === "MANAGER";

    if (!isKiosk && !targetIsAdmin) {
      if (
        qrInput.trim().toUpperCase() !== settings.qr_code.trim().toUpperCase()
      ) {
        showToast(
          "err",
          "Scan atau masukkan kode QR resmi kantor terlebih dahulu!"
        );
        return;
      }
      if (nearestGeofence && !nearestGeofence.inside) {
        showToast(
          "err",
          `Di luar radius lokasi (${nearestGeofence.distance}m > ${nearestGeofence.location.radius_meters}m).`
        );
        return;
      }
    }

    const punchedIso = new Date().toISOString();
    const lateInfo =
      entryType === "CLOCK_IN"
        ? calcLateFromShift(punchedIso, targetEmp?.shift_start_time || "07:00")
        : { isLate: false, lateMinutes: 0 };

    const selfieImg = cameraActive ? capturePhoto() : capturedSelfie;
    const uuid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const payload: TimeEntry = {
      client_uuid: uuid,
      employee_id: Number(targetEmpId),
      entry_type: entryType,
      punched_at: punchedIso,
      is_offline_sync: !navigator.onLine,
      project_id: selectedProjectId || null,
      activity_name: selectedActivity,
      location_id: nearestGeofence?.location.id || null,
      latitude: gpsCoords?.lat ?? null,
      longitude: gpsCoords?.lng ?? null,
      distance_meters: nearestGeofence?.distance ?? null,
      is_within_geofence: nearestGeofence ? nearestGeofence.inside : true,
      selfie_data: selfieImg || null,
      notes: isKiosk
        ? `[KIOSK - ${targetEmp?.shift_name || "Shift Pagi"}] ${punchNotes}`
        : `[${targetEmp?.shift_name || "Shift Pagi"}] ${punchNotes}`.trim(),
      is_late: lateInfo.isLate,
      late_minutes: lateInfo.lateMinutes,
    };

    const nextQ = [payload, ...offlineQueue];
    setOfflineQueue(nextQ);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(nextQ));
    setCapturedSelfie(null);
    setPunchNotes("");
    setQrInput("");
    stopQrScanner();

    if (navigator.onLine) {
      await syncOfflineQueueToServer(nextQ);
      await fetchBootstrapData();
      showToast("ok", `Berhasil ${entryType}!`);
    } else {
      showToast("warn", `Tersimpan Offline (${entryType}).`);
    }

    if (isKiosk) {
      setKioskPin("");
      setKioskEmployee(null);
    }
  };

  const dailyTimesheets = useMemo<TimesheetRow[]>(() => {
    const grouped = new Map<string, TimeEntry[]>();
    for (const e of allEntries) {
      const dStr = getJakartaDateStr(e.punched_at);
      if (filterDate && dStr !== filterDate) continue;
      if (filterEmpId !== "ALL" && String(e.employee_id) !== filterEmpId)
        continue;
      const k = `${e.employee_id}__${dStr}`;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(e);
    }

    const rows: TimesheetRow[] = [];
    grouped.forEach((items, key) => {
      const sorted = [...items].sort(
        (a, b) =>
          new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
      );
      const firstIn = sorted.find((i) => i.entry_type === "CLOCK_IN");
      const lastOut = [...sorted]
        .reverse()
        .find((i) => i.entry_type === "CLOCK_OUT");
      const empId = Number(sorted[0].employee_id);
      const dStr = key.split("__")[1];
      const emp = enrichedEmployees.find((e) => Number(e.id) === empId);
      const st = computeDayStats(empId, dStr);
      const targetH = Number(emp?.work_hours_target || 8);
      const totalH = st.workSeconds / 3600;
      const otH = Math.max(0, totalH - targetH);
      const rate = Number(emp?.hourly_rate || 25000);

      const fallbackLate =
        firstIn && firstIn.is_late === undefined
          ? calcLateFromShift(
              firstIn.punched_at,
              emp?.shift_start_time || "07:00"
            )
          : {
              isLate: Boolean(firstIn?.is_late),
              lateMinutes: Number(firstIn?.late_minutes || 0),
            };

      rows.push({
        key,
        dateStr: dStr,
        empCode: emp?.emp_code || "-",
        fullName: emp?.full_name || sorted[0].full_name || "Karyawan",
        clockIn: firstIn?.punched_at || null,
        clockOut: lastOut?.punched_at || null,
        projectName: firstIn?.project_name || "-",
        isLate: fallbackLate.isLate,
        lateMinutes: fallbackLate.lateMinutes,
        workSeconds: st.workSeconds,
        breakSeconds: st.breakSeconds,
        overtimeHours: otH.toFixed(2),
        estPay: Math.round(
          Math.min(totalH, targetH) * rate + otH * rate * 1.5
        ),
        approvalStatus: firstIn?.approval_status || "APPROVED",
      });
    });
    return rows;
  }, [allEntries, filterDate, filterEmpId, enrichedEmployees, computeDayStats]);

  const exportExcel = () => {
    const headers = [
      "Tanggal",
      "ID",
      "Nama",
      "Masuk",
      "Pulang",
      "Bekerja",
      "Lembur",
      "Gaji (Rp)",
    ];
    const body = dailyTimesheets.map((r) => [
      r.dateStr,
      r.empCode,
      r.fullName,
      formatTimeWIB(r.clockIn),
      formatTimeWIB(r.clockOut),
      formatHM(r.workSeconds),
      r.overtimeHours,
      r.estPay,
    ]);
    const html = `<table border="1"><tr>${headers
      .map((h) => `<th>${h}</th>`)
      .join("")}</tr>${body
      .map(
        (row) =>
          `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`
      )
      .join("")}</table>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([html], { type: "application/vnd.ms-excel" })
    );
    a.download = `Laporan_Absensi_${filterDate || "Semua"}.xls`;
    a.click();
  };

  const callManageApi = async (
    action: string,
    payload: Record<string, unknown>,
    msg: string
  ) => {
    if (!navigator.onLine) {
      showToast("err", "Butuh koneksi internet.");
      return;
    }
    const res = await fetch("/api/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast("ok", msg);
      await fetchBootstrapData();
    } else {
      showToast("err", data.error || "Gagal menyimpan");
    }
  };

  const handleAssignShift = async (emp: Employee, nextShiftId: number) => {
    const preset = resolveShiftPreset(nextShiftId);
    const updatedMap = { ...shiftMap, [emp.id]: preset.id };
    setShiftMap(updatedMap);
    localStorage.setItem(SHIFT_ASSIGN_KEY, JSON.stringify(updatedMap));

    if (navigator.onLine) {
      try {
        await fetch("/api/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SAVE_EMPLOYEE",
            payload: {
              ...emp,
              shift_id: preset.id,
              work_hours_target: preset.targetHours,
            },
          }),
        });
        await fetchBootstrapData();
      } catch {
        // Tetap tersimpan lokal bila endpoint belum mendukung field shift_id
      }
    }
    showToast(
      "ok",
      `${emp.full_name} diatur ke ${preset.name} (${preset.startTime})`
    );
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportStatus(`Membaca ${file.name}...`);
    setImportRows([]);

    try {
      const lowerName = file.name.toLowerCase();
      if (
        lowerName.endsWith(".csv") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".xlsx") ||
        lowerName.endsWith(".xls")
      ) {
        const text = await file.text();
        const parsed = parseDelimitedTextToItems(text);
        setImportRows(parsed);
        setImportStatus(
          parsed.length > 0
            ? `Ditemukan ${parsed.length} baris karyawan & jadwal dari ${file.name}.`
            : `Tidak ada baris CSV/teks valid pada ${file.name}. Simpan file Excel sebagai CSV (.csv) jika format biner.`
        );
      } else if (lowerName.endsWith(".pdf")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const extractedLines = extractReadableLinesFromPdfBytes(bytes);
        const parsed = parsePdfLinesToImportItems(extractedLines);
        setImportRows(parsed);
        setImportStatus(
          parsed.length > 0
            ? `Ditemukan ${parsed.length} baris karyawan & jadwal dari PDF.`
            : "Teks PDF terkompresi/hasil scan tidak terbaca langsung tanpa parser PDF; gunakan file .csv atau teks PDF standar."
        );
      } else {
        setImportStatus("Gunakan file .csv, .txt, atau .pdf.");
      }
    } catch (err) {
      setImportStatus(
        `Gagal membaca file: ${
          err instanceof Error ? err.message : "Error tidak diketahui"
        }`
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyImportedRows = async () => {
    if (importRows.length === 0) return;
    setIsImporting(true);
    let savedCount = 0;
    const nextShiftMap = { ...shiftMap };

    try {
      for (const row of importRows) {
        const existing = enrichedEmployees.find(
          (emp) =>
            emp.emp_code.trim().toLowerCase() ===
              row.emp_code.trim().toLowerCase() ||
            emp.full_name.trim().toLowerCase() ===
              row.full_name.trim().toLowerCase()
        );

        if (existing?.id) {
          nextShiftMap[existing.id] = row.shift_id;
        }

        if (navigator.onLine) {
          const res = await fetch("/api/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "SAVE_EMPLOYEE",
              payload: {
                id: existing?.id || 0,
                emp_code: existing?.emp_code || row.emp_code,
                full_name: row.full_name,
                role: existing?.role || row.role,
                department:
                  row.department || existing?.department || "Operasional",
                pin_code: existing?.pin_code || row.pin_code,
                hourly_rate: existing?.hourly_rate || row.hourly_rate,
                shift_id: row.shift_id,
                work_hours_target: 8,
              },
            }),
          });
          const data = await res.json();
          if (data.ok) {
            savedCount++;
            if (data.employee?.id) {
              nextShiftMap[Number(data.employee.id)] = row.shift_id;
            }
          }
        } else {
          savedCount++;
        }
      }

      setShiftMap(nextShiftMap);
      localStorage.setItem(SHIFT_ASSIGN_KEY, JSON.stringify(nextShiftMap));
      if (navigator.onLine) {
        await fetchBootstrapData();
      }
      showToast(
        "ok",
        `${savedCount} data karyawan & jadwal shift berhasil diproses!`
      );
      setImportRows([]);
      setImportStatus(`Selesai memproses ${savedCount} baris.`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleKioskDigit = (d: string) => {
    if (kioskPin.length >= 4) return;
    const next = kioskPin + d;
    setKioskPin(next);
    if (next.length === 4) {
      const found = enrichedEmployees.find((e) => e.pin_code === next);
      if (found) {
        setKioskEmployee(found);
        startCamera();
      } else {
        showToast("err", "PIN tidak ditemukan!");
        setTimeout(() => setKioskPin(""), 500);
      }
    }
  };

  const headerTitle =
    subView === "whosin"
      ? "Siapa yang Masuk/Keluar"
      : subView === "kiosk"
      ? "Mode Kios"
      : subView === "admin"
      ? "Pengaturan Admin"
      : mainTab === "beranda"
      ? "Dasbor"
      : mainTab === "timeclock"
      ? "Time Clock"
      : mainTab === "timesheet"
      ? "Timesheet"
      : mainTab === "persetujuan"
      ? "Persetujuan"
      : "Menu";

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-slate-900 pb-24 max-w-2xl mx-auto shadow-sm border-x border-slate-200/70">
      {toast && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg text-white text-xs font-semibold flex items-center gap-2 ${
            toast.type === "ok"
              ? "bg-emerald-600"
              : toast.type === "warn"
              ? "bg-amber-600"
              : "bg-rose-600"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{toast.text}</span>
        </div>
      )}

      <header className="bg-white sticky top-0 z-30 px-4 h-14 flex items-center justify-between border-b border-slate-100 no-print">
        <div className="w-10">
          {subView !== "none" && (
            <button
              onClick={() => {
                stopCamera();
                stopQrScanner();
                setSubView("none");
              }}
              className="p-1.5 -ml-1.5 rounded-full text-slate-700"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
        </div>
        <h1 className="text-[17px] font-bold text-slate-900 tracking-tight">
          {headerTitle}
        </h1>
        <button
          onClick={() => setAccountModalOpen(true)}
          className="relative w-9 h-9 rounded-full bg-[#737373] text-white font-semibold text-sm flex items-center justify-center"
        >
          {(activeEmployee?.full_name || "A").charAt(0).toUpperCase()}
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isOnline ? "bg-emerald-500" : "bg-amber-400"
            }`}
          />
        </button>
      </header>

      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-base">Akun Aktif & Sinkronisasi</h3>
                <p className="text-xs text-slate-500">
                  {isOnline ? "Terhubung ke Neon Cloud" : "Mode Offline Aktif"}
                </p>
              </div>
              <button
                onClick={() => setAccountModalOpen(false)}
                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100"
              >
                Tutup
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {enrichedEmployees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setSelectedEmpId(emp.id);
                    localStorage.setItem(ACTIVE_EMP_KEY, String(emp.id));
                    setAccountModalOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border text-left ${
                    Number(selectedEmpId) === Number(emp.id)
                      ? "border-orange-500 bg-orange-50"
                      : "border-slate-200"
                  }`}
                >
                  <div>
                    <div className="font-bold text-sm">{emp.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {emp.emp_code} • {emp.role} • {emp.shift_name} (
                      {emp.shift_start_time})
                    </div>
                  </div>
                  {Number(selectedEmpId) === Number(emp.id) && (
                    <span className="text-xs font-bold text-orange-600">
                      Aktif
                    </span>
                  )}
                </button>
              ))}
            </div>
            {offlineQueue.length > 0 && (
              <button
                onClick={() => syncOfflineQueueToServer(offlineQueue)}
                disabled={!isOnline || isSyncing}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-2"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`}
                />
                Sinkronkan {offlineQueue.length} Data Offline
              </button>
            )}
          </div>
        </div>
      )}

      {mainTab === "beranda" && subView === "none" && (
        <div>
          <div className="bg-white border-b border-slate-200/80 px-5 py-3 flex items-center justify-between">
            <div className="grid grid-cols-2 flex-1 gap-4">
              <button
                onClick={() =>
                  setDateRangeMode((p) => (p === "Hari" ? "Minggu" : "Hari"))
                }
                className="text-left"
              >
                <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  RENTANG TANGGAL
                </div>
                <div className="text-[15px] font-medium text-slate-800 mt-0.5">
                  {dateRangeMode}
                </div>
              </button>
              <button
                onClick={() =>
                  setViewScope((p) =>
                    p === "Organisasi" ? "Pribadi" : "Organisasi"
                  )
                }
                className="text-left border-l border-slate-100 pl-4"
              >
                <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  LIHAT
                </div>
                <div className="text-[15px] font-medium text-slate-800 mt-0.5">
                  {viewScope}
                </div>
              </button>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <div className="p-4 space-y-4">
            <div
              onClick={() => setSubView("whosin")}
              className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-slate-100 cursor-pointer"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-slate-900">
                  Siapa yang Masuk/Keluar
                </h2>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
              <div className="grid grid-cols-3 py-6 text-center">
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {whoIsInOutCounts.masuk}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    MASUK
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {whoIsInOutCounts.istirahat}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    ISTIRAHAT
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {whoIsInOutCounts.keluar}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    KELUAR
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-slate-100">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-slate-900">
                  Jam terlacak
                </h2>
                {!isOnline && (
                  <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    Offline
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 py-5 text-center border-b border-slate-100">
                <div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatHM(weeklyChartData.summaryWorkSec)}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    BEKERJA
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatHM(weeklyChartData.summaryBreakSec)}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    ISTIRAHAT
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatHM(weeklyChartData.summaryOtSec)}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">
                    LEMBUR
                  </div>
                </div>
              </div>

              <div className="px-5 pt-4 pb-5">
                <div className="flex items-center mb-2">
                  <div className="w-7 shrink-0" />
                  <div className="flex-1 flex justify-between text-[11px] text-slate-400 font-medium pr-12">
                    {weeklyChartData.ticks.map((t) => (
                      <span key={t}>{Math.round(t)}</span>
                    ))}
                  </div>
                </div>
                <div className="relative space-y-3.5">
                  {weeklyChartData.bars.map((bar) => {
                    const widthPct = Math.min(
                      100,
                      (bar.workSeconds / 3600 / weeklyChartData.axisMax) * 100
                    );
                    return (
                      <div key={bar.dateStr} className="flex items-center h-7">
                        <div
                          className={`w-7 shrink-0 text-xs ${
                            bar.isToday
                              ? "text-slate-900 font-bold"
                              : "text-slate-600 font-semibold"
                          }`}
                        >
                          {bar.label}
                        </div>
                        <div className="flex-1 flex items-center h-full relative">
                          <div className="absolute inset-y-0 left-0 right-12 flex justify-between pointer-events-none">
                            {weeklyChartData.ticks.map((t) => (
                              <div
                                key={t}
                                className="w-px h-full bg-slate-100"
                              />
                            ))}
                          </div>
                          {bar.workSeconds > 0 && (
                            <div className="relative z-10 flex items-center w-full pr-12">
                              <div
                                style={{
                                  width: `${Math.max(widthPct, 4)}%`,
                                }}
                                className="h-7 bg-[#00C805] rounded-r-[3px]"
                              />
                              <span className="ml-2.5 text-xs font-medium text-slate-600 whitespace-nowrap">
                                {formatHM(bar.workSeconds)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {subView === "whosin" && (
        <div className="p-4 space-y-3">
          {enrichedEmployees.map((emp) => {
            const st = computeDayStats(emp.id, todayStr);
            const firstIn = st.entries.find((e) => e.entry_type === "CLOCK_IN");
            return (
              <div
                key={emp.id}
                className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {firstIn?.selfie_data ? (
                    <img
                      src={firstIn.selfie_data}
                      alt={emp.full_name}
                      className="w-11 h-11 rounded-full object-cover border"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-slate-200 font-bold flex items-center justify-center">
                      {emp.full_name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-sm">{emp.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {emp.department} • {emp.shift_name} (
                      {emp.shift_start_time}) •{" "}
                      {firstIn
                        ? `Masuk ${formatTimeWIB(firstIn.punched_at)}`
                        : "Belum masuk"}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    st.status === "IN"
                      ? "bg-emerald-100 text-emerald-700"
                      : st.status === "BREAK"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {st.status === "IN"
                    ? "MASUK"
                    : st.status === "BREAK"
                    ? "ISTIRAHAT"
                    : "KELUAR"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {mainTab === "timeclock" &&
        subView === "none" &&
        activeEmployee &&
        activeEmpToday && (
          <div className="p-4 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-100 text-center space-y-4">
              <div className="flex items-center justify-between text-left border-b border-slate-100 pb-3">
                <div>
                  <div className="text-xs text-slate-400 font-semibold">
                    {activeEmployee.emp_code} • {activeEmployee.shift_name}{" "}
                    (Masuk {activeEmployee.shift_start_time})
                  </div>
                  <div className="font-bold text-base">
                    {activeEmployee.full_name}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    activeEmpToday.status === "IN"
                      ? "bg-emerald-100 text-emerald-700"
                      : activeEmpToday.status === "BREAK"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {activeEmpToday.status === "IN"
                    ? "BEKERJA"
                    : activeEmpToday.status === "BREAK"
                    ? "ISTIRAHAT"
                    : "KELUAR"}
                </span>
              </div>

              <div>
                <div className="text-xs text-slate-400">Durasi Hari Ini</div>
                <div className="text-4xl font-mono font-extrabold mt-1">
                  {formatDuration(activeEmpToday.workSeconds)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left">
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs bg-slate-50"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedActivity}
                  onChange={(e) => setSelectedActivity(e.target.value)}
                  className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs bg-slate-50"
                >
                  <option value="Kerja Reguler">Kerja Reguler</option>
                  <option value="Lapangan">Lapangan</option>
                  <option value="Lembur">Lembur</option>
                </select>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between text-left text-xs border border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPin
                    className={`w-4 h-4 ${
                      nearestGeofence?.inside
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  />
                  <div>
                    <div className="font-semibold">
                      {nearestGeofence
                        ? `${nearestGeofence.location.name} (${nearestGeofence.distance}m)`
                        : gpsStatus}
                    </div>
                    <div className="text-[11px] text-slate-400">{gpsStatus}</div>
                  </div>
                </div>
                <button
                  onClick={refreshGPS}
                  className="px-2.5 py-1 rounded-lg bg-white border font-semibold text-[11px]"
                >
                  Cek GPS
                </button>
              </div>

              <div className="text-left space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <QrCode className="w-3.5 h-3.5 text-emerald-600" /> Scan QR
                    Kantor
                  </span>
                  {!qrScanActive ? (
                    <button
                      onClick={startQrScanner}
                      className="text-xs font-bold text-emerald-700"
                    >
                      Buka Kamera QR
                    </button>
                  ) : (
                    <button
                      onClick={stopQrScanner}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold"
                    >
                      Tutup QR
                    </button>
                  )}
                </div>
                {qrScanActive && (
                  <div className="w-44 h-44 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-emerald-500">
                    <video
                      ref={qrVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <input
                  type="text"
                  placeholder="Scan QR atau masukkan kode QR resmi kantor..."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
                />
              </div>

              <div className="text-left">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5 text-orange-500" /> Selfie
                  </span>
                  {!cameraActive ? (
                    <button
                      onClick={startCamera}
                      className="text-xs font-bold text-orange-600"
                    >
                      {capturedSelfie ? "Foto Ulang" : "Buka Kamera"}
                    </button>
                  ) : (
                    <button
                      onClick={capturePhoto}
                      className="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-xs font-bold"
                    >
                      Ambil Foto
                    </button>
                  )}
                </div>
                {cameraActive && (
                  <div className="w-36 h-36 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-orange-500">
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
                  <img
                    src={capturedSelfie}
                    alt="Selfie"
                    className="w-12 h-12 rounded-xl object-cover border"
                  />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              <input
                type="text"
                placeholder="Catatan opsional..."
                value={punchNotes}
                onChange={(e) => setPunchNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />

              <div className="grid grid-cols-2 gap-2.5">
                {activeEmpToday.status === "OUT" && (
                  <button
                    onClick={() =>
                      handleRecordPunch(activeEmployee.id, "CLOCK_IN")
                    }
                    className="col-span-2 py-3.5 rounded-2xl bg-[#00C805] text-white font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-current" /> CLOCK IN
                  </button>
                )}
                {activeEmpToday.status === "IN" && (
                  <>
                    <button
                      onClick={() =>
                        handleRecordPunch(activeEmployee.id, "BREAK_START")
                      }
                      className="py-3.5 rounded-2xl bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-1"
                    >
                      <Coffee className="w-4 h-4" /> ISTIRAHAT
                    </button>
                    <button
                      onClick={() =>
                        handleRecordPunch(activeEmployee.id, "CLOCK_OUT")
                      }
                      className="py-3.5 rounded-2xl bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1"
                    >
                      <Square className="w-4 h-4 fill-current" /> CLOCK OUT
                    </button>
                  </>
                )}
                {activeEmpToday.status === "BREAK" && (
                  <>
                    <button
                      onClick={() =>
                        handleRecordPunch(activeEmployee.id, "BREAK_END")
                      }
                      className="py-3.5 rounded-2xl bg-[#00C805] text-white font-bold text-xs"
                    >
                      LANJUT KERJA
                    </button>
                    <button
                      onClick={() =>
                        handleRecordPunch(activeEmployee.id, "CLOCK_OUT")
                      }
                      className="py-3.5 rounded-2xl bg-rose-600 text-white font-bold text-xs"
                    >
                      PULANG
                    </button>
                  </>
                )}
              </div>
            </div>

            {isAdmin && (
              <div
                className="card bg-white rounded-2xl p-5 border border-slate-100"
                style={{ textAlign: "center" }}
              >
                <strong>QR Code Resmi ({settings.office_name})</strong>
                <p style={{ fontSize: 12, color: "#64748b" }}>
                  Radius GPS: Maks. {settings.radius_meters} meter
                </p>
                <img
                  src={qrUrl}
                  alt="QR Kantor"
                  style={{
                    width: 200,
                    height: 200,
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 8,
                    margin: "0 auto",
                  }}
                />
                <div style={{ fontWeight: 800, marginTop: 8 }}>
                  {settings.qr_code}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "center",
                    marginTop: 12,
                  }}
                >
                  <a
                    href={qrUrl}
                    download={`${settings.qr_code}.png`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn px-4 py-2 rounded-xl text-xs font-bold"
                    style={{
                      background: "#047857",
                      color: "#fff",
                      textDecoration: "none",
                    }}
                  >
                    Download PNG
                  </a>
                  <button
                    className="btn px-4 py-2 rounded-xl text-xs font-bold"
                    style={{ background: "#0f172a", color: "#fff" }}
                    onClick={() => window.print()}
                  >
                    Cetak QR
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      {mainTab === "timesheet" && subView === "none" && (
        <div className="p-4 space-y-3">
          <div className="bg-white rounded-2xl p-3.5 border border-slate-100 space-y-2 no-print">
            <div className="flex gap-2">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-1.5 text-xs"
              />
              <button
                onClick={() => setFilterDate("")}
                className="px-3 py-1.5 rounded-xl bg-slate-100 text-xs font-semibold"
              >
                Semua
              </button>
            </div>
            <div className="flex gap-2">
              <select
                value={filterEmpId}
                onChange={(e) => setFilterEmpId(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-1.5 text-xs"
              >
                <option value="ALL">Semua Karyawan</option>
                {enrichedEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
              {isAdmin && (
                <>
                  <button
                    onClick={exportExcel}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="px-3 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <Printer className="w-3.5 h-3.5" /> PDF
                  </button>
                </>
              )}
            </div>
          </div>
          {dailyTimesheets.map((r) => (
            <div
              key={r.key}
              className="bg-white rounded-2xl p-4 border border-slate-100 space-y-1.5"
            >
              <div className="flex justify-between">
                <div>
                  <div className="font-bold text-sm">{r.fullName}</div>
                  <div className="text-[11px] text-slate-400">
                    {r.dateStr} • {r.projectName}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm text-[#00C805]">
                    {formatHM(r.workSeconds)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Rp {r.estPay.toLocaleString("id-ID")}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 pt-1.5 border-t border-slate-100 flex justify-between">
                <span>
                  Masuk: <b>{formatTimeWIB(r.clockIn)}</b> • Pulang:{" "}
                  <b>{formatTimeWIB(r.clockOut)}</b>
                </span>
                {r.isLate && (
                  <span className="text-rose-600 font-bold">
                    Telat {r.lateMinutes}m
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {mainTab === "persetujuan" && subView === "none" && (
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-2.5">
            <h2 className="font-bold text-sm">
              Ajukan Cuti / Izin ({activeEmployee?.full_name})
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={leaveForm.leave_type}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, leave_type: e.target.value })
                }
                className="rounded-xl border px-2 py-2 text-xs"
              >
                <option value="CUTI_TAHUNAN">Cuti</option>
                <option value="SAKIT">Sakit</option>
                <option value="IZIN">Izin</option>
              </select>
              <input
                type="date"
                value={leaveForm.start_date}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, start_date: e.target.value })
                }
                className="rounded-xl border px-2 py-2 text-xs"
              />
              <input
                type="date"
                value={leaveForm.end_date}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, end_date: e.target.value })
                }
                className="rounded-xl border px-2 py-2 text-xs"
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Alasan..."
                value={leaveForm.reason}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, reason: e.target.value })
                }
                className="flex-1 rounded-xl border px-3 py-2 text-xs"
              />
              <button
                onClick={() => {
                  if (!leaveForm.start_date || !leaveForm.end_date) return;
                  callManageApi(
                    "CREATE_LEAVE",
                    { employee_id: activeEmployee?.id, ...leaveForm },
                    "Terkirim!"
                  );
                  setLeaveForm({ ...leaveForm, reason: "" });
                }}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white font-bold text-xs"
              >
                Kirim
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-2">
            <h3 className="font-bold text-xs">Daftar Cuti & Izin</h3>
            {leaves.map((lv) => (
              <div
                key={lv.id}
                className="p-3 rounded-xl bg-slate-50 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold">
                    {lv.full_name} ({lv.leave_type})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {String(lv.start_date).slice(0, 10)} s/d{" "}
                    {String(lv.end_date).slice(0, 10)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-white border text-[10px] font-bold">
                    {lv.status}
                  </span>
                  {isAdmin && lv.status === "PENDING" && (
                    <button
                      onClick={() =>
                        callManageApi(
                          "UPDATE_LEAVE_STATUS",
                          { id: lv.id, status: "APPROVED" },
                          "Disetujui!"
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px]"
                    >
                      Setujui
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mainTab === "menu" && subView === "none" && (
        <div className="p-4 space-y-3">
          {isAdmin && (
            <button
              onClick={() => setSubView("kiosk")}
              className="w-full bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <MonitorSmartphone className="w-5 h-5 text-orange-600" />
                <div>
                  <div className="font-bold text-sm">Mode Kios (Shared PIN)</div>
                  <div className="text-xs text-slate-500">
                    Absen cepat dengan PIN & Selfie
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setSubView("admin")}
              className="w-full bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-slate-700" />
                <div>
                  <div className="font-bold text-sm">
                    Pengaturan Admin, Shift & Import Massal
                  </div>
                  <div className="text-xs text-slate-500">
                    Shift Pagi/Siang/Malam, Import PDF/CSV, QR & GPS
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          )}
          <button
            onClick={() => setSubView("whosin")}
            className="w-full bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-emerald-700" />
              <div>
                <div className="font-bold text-sm">Live Tim (Who&apos;s In)</div>
                <div className="text-xs text-slate-500">
                  Pantau foto selfie & jam masuk tim
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      )}

      {subView === "kiosk" && isAdmin && (
        <div className="p-4">
          <div className="bg-slate-900 text-white rounded-3xl p-6 text-center space-y-4">
            <h2 className="text-lg font-bold">Masukkan 4-Digit PIN Kios</h2>
            <p className="text-xs text-slate-400">
              Admin: 0000 | Budi: 1111 | Siti: 2222
            </p>
            {!kioskEmployee ? (
              <>
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-12 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-2xl font-bold"
                    >
                      {kioskPin[i] ? "•" : ""}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(
                    (b) => (
                      <button
                        key={b}
                        onClick={() => {
                          if (b === "C") setKioskPin("");
                          else if (b === "⌫")
                            setKioskPin((p) => p.slice(0, -1));
                          else handleKioskDigit(b);
                        }}
                        className="h-14 rounded-2xl bg-slate-800 active:bg-orange-500 text-xl font-bold"
                      >
                        {b}
                      </button>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="font-bold text-orange-400 text-lg">
                  {kioskEmployee.full_name}
                </div>
                <div className="text-xs text-slate-300">
                  {kioskEmployee.shift_name} • Masuk{" "}
                  {kioskEmployee.shift_start_time}
                </div>
                <div className="w-36 h-36 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-orange-500">
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
                    onClick={() =>
                      handleRecordPunch(kioskEmployee.id, "CLOCK_IN", true)
                    }
                    className="py-3 rounded-xl bg-[#00C805] font-bold text-xs"
                  >
                    CLOCK IN
                  </button>
                  <button
                    onClick={() =>
                      handleRecordPunch(kioskEmployee.id, "CLOCK_OUT", true)
                    }
                    className="py-3 rounded-xl bg-rose-600 font-bold text-xs"
                  >
                    CLOCK OUT
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
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {subView === "admin" && isAdmin && (
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <h3 className="font-bold text-sm">Jadwal Shift Resmi (WIB)</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {SHIFT_PRESETS.map((sp) => (
                <div
                  key={sp.id}
                  className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
                >
                  <div className="text-xs font-bold text-slate-800">
                    {sp.name}
                  </div>
                  <div className="text-sm font-mono font-extrabold text-[#00C805] mt-0.5">
                    {sp.startTime}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">
                Import Massal Karyawan & Jadwal (.csv / .txt / .pdf)
              </h3>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                {isImporting ? "Memproses..." : "Pilih File"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.pdf,.xlsx,.xls"
                onChange={handleImportFileChange}
                className="hidden"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Format CSV/Teks: <b>emp_code,full_name,shift,department,pin_code</b>{" "}
              (contoh: <code>KRY-005,Andi,Shift Siang,Operasional,3333</code>).
            </p>
            {importStatus && (
              <div className="text-xs font-medium text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                {importStatus}
              </div>
            )}
            {importRows.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {importRows.map((item, idx) => (
                    <div
                      key={`${item.emp_code}-${idx}`}
                      className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/70 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold">{item.full_name}</span>{" "}
                        <span className="text-slate-500">({item.emp_code})</span>
                        <div className="text-[11px] text-slate-600">
                          {item.department} • PIN: {item.pin_code}
                          {item.schedule_date
                            ? ` • Tgl: ${item.schedule_date}`
                            : ""}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-white border font-bold text-[11px] text-emerald-700">
                        {item.shift_name} ({item.shift_start_time})
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={applyImportedRows}
                  disabled={isImporting}
                  className="w-full py-2.5 rounded-xl bg-[#FF6B00] text-white font-bold text-xs"
                >
                  Simpan {importRows.length} Karyawan & Jadwal ke Sistem
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <h3 className="font-bold text-sm">Kode QR Resmi Kantor</h3>
            <div className="flex gap-2">
              <input
                placeholder="Kode QR Kantor (contoh: ABSENSI-KANTOR-MPI-BTG)"
                value={officeQrCode}
                onChange={(e) => {
                  setOfficeQrCode(e.target.value);
                  localStorage.setItem(QR_CODE_KEY, e.target.value);
                }}
                className="flex-1 rounded-xl border px-3 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm">Lokasi GPS & Radius</h3>
              {gpsCoords && (
                <button
                  onClick={() =>
                    setNewLoc({
                      ...newLoc,
                      latitude: String(gpsCoords.lat),
                      longitude: String(gpsCoords.lng),
                    })
                  }
                  className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg"
                >
                  Ambil GPS Saya
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Nama Lokasi"
                value={newLoc.name}
                onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
                className="col-span-2 rounded-xl border px-3 py-1.5 text-xs"
              />
              <input
                placeholder="Latitude"
                value={newLoc.latitude}
                onChange={(e) =>
                  setNewLoc({ ...newLoc, latitude: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <input
                placeholder="Longitude"
                value={newLoc.longitude}
                onChange={(e) =>
                  setNewLoc({ ...newLoc, longitude: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <input
                type="number"
                placeholder="Radius (m)"
                value={newLoc.radius_meters}
                onChange={(e) =>
                  setNewLoc({ ...newLoc, radius_meters: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <button
                onClick={() => {
                  if (!newLoc.name || !newLoc.latitude) return;
                  callManageApi("SAVE_LOCATION", newLoc, "Lokasi disimpan!");
                  setNewLoc({
                    name: "",
                    address: "",
                    latitude: "",
                    longitude: "",
                    radius_meters: "150",
                  });
                }}
                className="rounded-xl bg-emerald-600 text-white font-bold text-xs"
              >
                + Simpan
              </button>
            </div>
            {locations.map((loc) => (
              <div
                key={loc.id}
                className="p-2.5 rounded-xl bg-slate-50 flex justify-between items-center text-xs"
              >
                <div>
                  <div className="font-bold">{loc.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {loc.latitude}, {loc.longitude} ({loc.radius_meters}m)
                  </div>
                </div>
                <button
                  onClick={() =>
                    callManageApi("DELETE_LOCATION", { id: loc.id }, "Dihapus")
                  }
                  className="text-rose-600 font-bold"
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <h3 className="font-bold text-sm">Karyawan, Shift & PIN Kios</h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="ID (KRY-003)"
                value={newEmp.emp_code}
                onChange={(e) =>
                  setNewEmp({ ...newEmp, emp_code: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <input
                placeholder="Nama Lengkap"
                value={newEmp.full_name}
                onChange={(e) =>
                  setNewEmp({ ...newEmp, full_name: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <input
                placeholder="PIN 4 Digit"
                maxLength={4}
                value={newEmp.pin_code}
                onChange={(e) =>
                  setNewEmp({ ...newEmp, pin_code: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs"
              />
              <select
                value={newEmp.shift_id}
                onChange={(e) =>
                  setNewEmp({ ...newEmp, shift_id: e.target.value })
                }
                className="rounded-xl border px-3 py-1.5 text-xs bg-white"
              >
                <option value="1">Shift Pagi (07:00)</option>
                <option value="2">Shift Siang (15:00)</option>
                <option value="3">Shift Malam (23:00)</option>
              </select>
              <button
                onClick={() => {
                  if (!newEmp.emp_code || !newEmp.full_name) return;
                  const preset = resolveShiftPreset(Number(newEmp.shift_id));
                  callManageApi(
                    "SAVE_EMPLOYEE",
                    {
                      ...newEmp,
                      shift_id: preset.id,
                      work_hours_target: preset.targetHours,
                    },
                    "Ditambahkan!"
                  );
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
                className="col-span-2 py-2 rounded-xl bg-orange-500 text-white font-bold text-xs"
              >
                + Tambah Karyawan
              </button>
            </div>
            {enrichedEmployees.map((e) => (
              <div
                key={e.id}
                className="p-2.5 rounded-xl bg-slate-50 flex flex-wrap gap-2 justify-between items-center text-xs"
              >
                <div>
                  <span className="font-bold">{e.full_name}</span> ({e.emp_code}
                  ) • PIN: {e.pin_code}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={e.shift_id || 1}
                    onChange={(ev) =>
                      handleAssignShift(e, Number(ev.target.value))
                    }
                    className="rounded-lg border bg-white px-2 py-1 text-[11px] font-semibold"
                  >
                    <option value={1}>Shift Pagi (07:00)</option>
                    <option value={2}>Shift Siang (15:00)</option>
                    <option value={3}>Shift Malam (23:00)</option>
                  </select>
                  {e.role !== "ADMIN" && (
                    <button
                      onClick={() =>
                        callManageApi(
                          "DELETE_EMPLOYEE",
                          { id: e.id },
                          "Dihapus"
                        )
                      }
                      className="text-rose-600 font-bold"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 inset-x-0 max-w-2xl mx-auto bg-white border-t border-slate-200 grid grid-cols-5 py-1.5 z-40 no-print">
        {[
          { id: "beranda", label: "Beranda", icon: Home },
          { id: "timeclock", label: "Time Clock", icon: Clock },
          { id: "timesheet", label: "Timesheet", icon: FileText },
          { id: "persetujuan", label: "Persetujuan", icon: ShieldCheck },
          { id: "menu", label: "Menu", icon: Menu },
        ].map((item) => {
          const Icon = item.icon;
          const active = mainTab === item.id && subView === "none";
          return (
            <button
              key={item.id}
              onClick={() => {
                stopCamera();
                stopQrScanner();
                setSubView("none");
                setMainTab(item.id as MainTab);
              }}
              className={`flex flex-col items-center justify-center py-1 text-[11px] font-medium ${
                active ? "text-[#FF6B00] font-semibold" : "text-slate-500"
              }`}
            >
              <Icon
                strokeWidth={active ? 2.2 : 1.75}
                className={`w-5 h-5 mb-1 ${
                  active ? "text-[#FF6B00]" : "text-slate-500"
                }`}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
