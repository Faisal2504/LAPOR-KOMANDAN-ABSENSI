"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Home, Clock, FileText, ShieldCheck, Menu, ChevronRight, RefreshCw,
  MapPin, Camera, Play, Coffee, Square, AlertTriangle, Download,
  Printer, Users, MonitorSmartphone, Settings, ArrowLeft,
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

const CACHE_KEY = "jibblepro_master_cache_v2";
const QUEUE_KEY = "jibblepro_offline_queue_v2";
const ACTIVE_EMP_KEY = "jibblepro_active_emp_id_v2";

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
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function JibbleDashboardApp() {
  const [mainTab, setMainTab] = useState<"beranda" | "timeclock" | "timesheet" | "persetujuan" | "menu">("beranda");
  const [subView, setSubView] = useState<"none" | "whosin" | "kiosk" | "admin">("none");
  const [dateRangeMode, setDateRangeMode] = useState<"Hari" | "Minggu">("Hari");
  const [viewScope, setViewScope] = useState<"Organisasi" | "Pribadi">("Organisasi");
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [toast, setToast] = useState<{ type: "ok" | "warn" | "err"; text: string } | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [serverEntries, setServerEntries] = useState<TimeEntry[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<TimeEntry[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);

  const [selectedEmpId, setSelectedEmpId] = useState<number>(1);
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1);
  const [selectedActivity, setSelectedActivity] = useState("Kerja Reguler");
  const [punchNotes, setPunchNotes] = useState("");

  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState("Mencari titik GPS...");
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [kioskPin, setKioskPin] = useState("");
  const [kioskEmployee, setKioskEmployee] = useState<Employee | null>(null);

  const [filterDate, setFilterDate] = useState(() => getJakartaDateStr(new Date().toISOString()));
  const [filterEmpId, setFilterEmpId] = useState("ALL");

  const [newEmp, setNewEmp] = useState({ id: 0, emp_code: "", full_name: "", role: "STAFF", department: "Operasional", pin_code: "1234", hourly_rate: "25000", shift_id: "1" });
  const [newLoc, setNewLoc] = useState({ name: "", address: "", latitude: "", longitude: "", radius_meters: "150" });
  const [leaveForm, setLeaveForm] = useState({ leave_type: "CUTI_TAHUNAN", start_date: "", end_date: "", reason: "" });

  const showToast = useCallback((type: "ok" | "warn" | "err", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onOnline = () => { setIsOnline(true); showToast("ok", "Online kembali. Menyinkronkan data..."); };
    const onOffline = () => { setIsOnline(false); showToast("warn", "Mode Offline aktif. Tersimpan di HP."); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(() => setNowTick(new Date()), 1000);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); clearInterval(t); };
  }, [showToast]);

  useEffect(() => {
    try {
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
    } catch {}
  }, []);

  const syncOfflineQueueToServer = useCallback(async (queue: TimeEntry[]) => {
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
  }, [showToast]);

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
        if (data.employees?.length > 0 && !localStorage.getItem(ACTIVE_EMP_KEY)) setSelectedEmpId(Number(data.employees[0].id));
        if (data.projects?.length > 0) setSelectedProjectId(Number(data.projects[0].id));
        localStorage.setItem(CACHE_KEY, JSON.stringify({ employees: data.employees, locations: data.locations, projects: data.projects, entries: data.entries, leaves: data.leaves }));
      }
    } catch {}
  }, [syncOfflineQueueToServer]);

  useEffect(() => { fetchBootstrapData(); }, [fetchBootstrapData, isOnline]);

  const refreshGPS = useCallback(() => {
    if (!("geolocation" in navigator)) { setGpsStatus("GPS tidak didukung"); return; }
    setGpsStatus("Mencari GPS...");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus(`Akurasi ±${Math.round(pos.coords.accuracy)}m`); },
      (err) => setGpsStatus(`GPS Terbatas (${err.message})`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  }, []);

  useEffect(() => { refreshGPS(); }, [refreshGPS]);

  const startCamera = async () => {
    try {
      setCapturedSelfie(null);
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, audio: false });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraActive(false);
      showToast("warn", "Kamera tidak tersedia, absen tetap bisa dilanjutkan.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return capturedSelfie;
    const c = canvasRef.current;
    c.width = 240; c.height = 240;
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
    const localOnly = offlineQueue.filter((q) => !ids.has(q.client_uuid)).map((q) => {
      const emp = employees.find((e) => Number(e.id) === Number(q.employee_id));
      const proj = projects.find((p) => Number(p.id) === Number(q.project_id));
      return { ...q, full_name: emp?.full_name || "Karyawan", emp_code: emp?.emp_code || "-", department: emp?.department || "-", hourly_rate: emp?.hourly_rate || 25000, project_name: proj?.name || "Operasional" };
    });
    return [...localOnly, ...serverEntries].sort((a, b) => new Date(b.punched_at).getTime() - new Date(a.punched_at).getTime());
  }, [serverEntries, offlineQueue, employees, projects]);

  const nearestGeofence = useMemo(() => {
    if (!gpsCoords || locations.length === 0) return null;
    let best = locations[0];
    let minD = haversineMeters(gpsCoords.lat, gpsCoords.lng, Number(best.latitude), Number(best.longitude));
    for (const loc of locations) {
      const d = haversineMeters(gpsCoords.lat, gpsCoords.lng, Number(loc.latitude), Number(loc.longitude));
      if (d < minD) { minD = d; best = loc; }
    }
    return { location: best, distance: minD, inside: minD <= Number(best.radius_meters) };
  }, [gpsCoords, locations]);

  const todayStr = getJakartaDateStr(nowTick.toISOString());

  const computeDayStats = useCallback((empId: number, targetDate: string) => {
    const list = allEntries
      .filter((e) => Number(e.employee_id) === Number(empId) && getJakartaDateStr(e.punched_at) === targetDate)
      .sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());
    if (list.length === 0) return { status: "OUT" as const, workSeconds: 0, breakSeconds: 0, overtimeSeconds: 0, entries: [] };

    let workSec = 0, breakSec = 0, activeStart: number | null = null, breakStart: number | null = null;
    for (const it of list) {
      const ts = new Date(it.punched_at).getTime();
      if (it.entry_type === "CLOCK_IN" || it.entry_type === "BREAK_END") {
        if (breakStart !== null) { breakSec += Math.max(0, (ts - breakStart) / 1000); breakStart = null; }
        activeStart = ts;
      } else if (it.entry_type === "BREAK_START") {
        if (activeStart !== null) { workSec += Math.max(0, (ts - activeStart) / 1000); activeStart = null; }
        breakStart = ts;
      } else if (it.entry_type === "CLOCK_OUT") {
        if (activeStart !== null) { workSec += Math.max(0, (ts - activeStart) / 1000); activeStart = null; }
      }
    }
    const last = list[list.length - 1];
    let status: "IN" | "BREAK" | "OUT" = "OUT";
    if (last.entry_type === "CLOCK_IN" || last.entry_type === "BREAK_END") {
      status = "IN";
      if (activeStart !== null && targetDate === todayStr) workSec += Math.max(0, (nowTick.getTime() - activeStart) / 1000);
    } else if (last.entry_type === "BREAK_START") {
      status = "BREAK";
      if (breakStart !== null && targetDate === todayStr) breakSec += Math.max(0, (nowTick.getTime() - breakStart) / 1000);
    }
    const emp = employees.find((e) => Number(e.id) === Number(empId));
    const targetSec = Number(emp?.work_hours_target || 8) * 3600;
    return { status, workSeconds: Math.floor(workSec), breakSeconds: Math.floor(breakSec), overtimeSeconds: Math.floor(Math.max(0, workSec - targetSec)), entries: list };
  }, [allEntries, todayStr, nowTick, employees]);

  const activeEmployee = useMemo(() => employees.find((e) => Number(e.id) === Number(selectedEmpId)) || employees[0], [employees, selectedEmpId]);
  const activeEmpToday = useMemo(() => (activeEmployee ? computeDayStats(activeEmployee.id, todayStr) : null), [activeEmployee, computeDayStats, todayStr]);

  const whoIsInOutCounts = useMemo(() => {
    const scopeEmps = viewScope === "Organisasi" ? employees : activeEmployee ? [activeEmployee] : [];
    let masuk = 0, istirahat = 0, keluar = 0;
    for (const emp of scopeEmps) {
      const st = computeDayStats(emp.id, todayStr);
      if (st.status === "IN") masuk++;
      else if (st.status === "BREAK") istirahat++;
      else keluar++;
    }
    return { masuk, istirahat, keluar };
  }, [employees, viewScope, activeEmployee, computeDayStats, todayStr]);

  const weeklyChartData = useMemo(() => {
    const dayLabels = ["S", "S", "R", "K", "J", "S", "M"];
    const jNow = new Date(nowTick.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const jsDay = jNow.getDay();
    const monday = new Date(jNow);
    monday.setDate(jNow.getDate() + (jsDay === 0 ? -6 : 1 - jsDay));
    const scopeEmps = viewScope === "Organisasi" ? employees : activeEmployee ? [activeEmployee] : [];

    const bars = dayLabels.map((label, idx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + idx);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      let w = 0, b = 0, o = 0;
      for (const emp of scopeEmps) {
        const st = computeDayStats(emp.id, dStr);
        w += st.workSeconds; b += st.breakSeconds; o += st.overtimeSeconds;
      }
      return { label, dateStr: dStr, isToday: dStr === todayStr, workSeconds: w, breakSeconds: b, overtimeSeconds: o };
    });

    const todayBar = bars.find((b) => b.isToday) || bars[0];
    const summaryWorkSec = dateRangeMode === "Hari" ? todayBar.workSeconds : bars.reduce((a, b) => a + b.workSeconds, 0);
    const summaryBreakSec = dateRangeMode === "Hari" ? todayBar.breakSeconds : bars.reduce((a, b) => a + b.breakSeconds, 0);
    const summaryOtSec = dateRangeMode === "Hari" ? todayBar.overtimeSeconds : bars.reduce((a, b) => a + b.overtimeSeconds, 0);
    const maxH = Math.max(...bars.map((b) => b.workSeconds / 3600), 0);
    const axisMax = maxH <= 18 ? 18 : Math.ceil(maxH / 6) * 6;
    const step = axisMax / 6;
    return { bars, summaryWorkSec, summaryBreakSec, summaryOtSec, axisMax, ticks: [0, step, step * 2, step * 3, step * 4, step * 5, axisMax] };
  }, [nowTick, viewScope, employees, activeEmployee, computeDayStats, todayStr, dateRangeMode]);

  const handleRecordPunch = async (targetEmpId: number, entryType: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT", isKiosk = false) => {
    const selfieImg = cameraActive ? capturePhoto() : capturedSelfie;
    const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload: TimeEntry = {
      client_uuid: uuid, employee_id: Number(targetEmpId), entry_type: entryType, punched_at: new Date().toISOString(),
      is_offline_sync: !navigator.onLine, project_id: selectedProjectId || null, activity_name: selectedActivity,
      location_id: nearestGeofence?.location.id || null, latitude: gpsCoords?.lat ?? null, longitude: gpsCoords?.lng ?? null,
      distance_meters: nearestGeofence?.distance ?? null, is_within_geofence: nearestGeofence ? nearestGeofence.inside : true,
      selfie_data: selfieImg || null, notes: isKiosk ? `[KIOSK] ${punchNotes}` : punchNotes,
    };
    const nextQ = [payload, ...offlineQueue];
    setOfflineQueue(nextQ);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(nextQ));
    setCapturedSelfie(null);
    setPunchNotes("");
    if (navigator.onLine) {
      await syncOfflineQueueToServer(nextQ);
      await fetchBootstrapData();
      showToast("ok", `Berhasil ${entryType}!`);
    } else {
      showToast("warn", `Tersimpan Offline (${entryType}).`);
    }
    if (isKiosk) { setKioskPin(""); setKioskEmployee(null); }
  };

  const dailyTimesheets = useMemo(() => {
    const grouped = new Map<string, TimeEntry[]>();
    for (const e of allEntries) {
      const dStr = getJakartaDateStr(e.punched_at);
      if (filterDate && dStr !== filterDate) continue;
      if (filterEmpId !== "ALL" && String(e.employee_id) !== filterEmpId) continue;
      const k = `${e.employee_id}__${dStr}`;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(e);
    }
    const rows: any[] = [];
    grouped.forEach((items, key) => {
      const sorted = [...items].sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());
      const firstIn = sorted.find((i) => i.entry_type === "CLOCK_IN");
      const lastOut = [...sorted].reverse().find((i) => i.entry_type === "CLOCK_OUT");
      const empId = Number(sorted[0].employee_id);
      const dStr = key.split("__")[1];
      const emp = employees.find((e) => Number(e.id) === empId);
      const st = computeDayStats(empId, dStr);
      const targetH = Number(emp?.work_hours_target || 8);
      const totalH = st.workSeconds / 3600;
      const otH = Math.max(0, totalH - targetH);
      const rate = Number(emp?.hourly_rate || 25000);
      rows.push({
        key, dateStr: dStr, empCode: emp?.emp_code || "-", fullName: emp?.full_name || sorted[0].full_name || "Karyawan",
        clockIn: firstIn?.punched_at || null, clockOut: lastOut?.punched_at || null, projectName: firstIn?.project_name || "-",
        isLate: Boolean(firstIn?.is_late), lateMinutes: Number(firstIn?.late_minutes || 0), workSeconds: st.workSeconds,
        breakSeconds: st.breakSeconds, overtimeHours: otH.toFixed(2), estPay: Math.round(Math.min(totalH, targetH) * rate + otH * rate * 1.5),
        approvalStatus: firstIn?.approval_status || "APPROVED",
      });
    });
    return rows;
  }, [allEntries, filterDate, filterEmpId, employees, computeDayStats]);

  const exportExcel = () => {
    const headers = ["Tanggal", "ID", "Nama", "Masuk", "Pulang", "Bekerja", "Lembur", "Gaji (Rp)"];
    const body = dailyTimesheets.map((r) => [r.dateStr, r.empCode, r.fullName, formatTimeWIB(r.clockIn), formatTimeWIB(r.clockOut), formatHM(r.workSeconds), r.overtimeHours, r.estPay]);
    const html = `<table border="1"><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${body.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel" }));
    a.download = `Laporan_Absensi_${filterDate || "Semua"}.xls`;
    a.click();
  };

  const callManageApi = async (action: string, payload: any, msg: string) => {
    if (!navigator.onLine) { showToast("err", "Butuh koneksi internet."); return; }
    const res = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const data = await res.json();
    if (data.ok) { showToast("ok", msg); await fetchBootstrapData(); }
    else showToast("err", data.error || "Gagal menyimpan");
  };

  const handleKioskDigit = (d: string) => {
    if (kioskPin.length >= 4) return;
    const next = kioskPin + d;
    setKioskPin(next);
    if (next.length === 4) {
      const found = employees.find((e) => e.pin_code === next);
      if (found) { setKioskEmployee(found); startCamera(); }
      else { showToast("err", "PIN tidak ditemukan!"); setTimeout(() => setKioskPin(""), 500); }
    }
  };

  const isAdmin = activeEmployee?.role === "ADMIN" || activeEmployee?.role === "MANAGER";
  const headerTitle = subView === "whosin" ? "Siapa yang Masuk/Keluar" : subView === "kiosk" ? "Mode Kios" : subView === "admin" ? "Pengaturan Admin" : mainTab === "beranda" ? "Dasbor" : mainTab === "timeclock" ? "Time Clock" : mainTab === "timesheet" ? "Timesheet" : mainTab === "persetujuan" ? "Persetujuan" : "Menu";

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-slate-900 pb-24 max-w-2xl mx-auto shadow-sm border-x border-slate-200/70">
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg text-white text-xs font-semibold flex items-center gap-2 ${toast.type === "ok" ? "bg-emerald-600" : toast.type === "warn" ? "bg-amber-600" : "bg-rose-600"}`}>
          <AlertTriangle className="w-3.5 h-3.5" /><span>{toast.text}</span>
        </div>
      )}

      <header className="bg-white sticky top-0 z-30 px-4 h-14 flex items-center justify-between border-b border-slate-100 no-print">
        <div className="w-10">
          {subView !== "none" && (
            <button onClick={() => { stopCamera(); setSubView("none"); }} className="p-1.5 -ml-1.5 rounded-full text-slate-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
        </div>
        <h1 className="text-[17px] font-bold text-slate-900 tracking-tight">{headerTitle}</h1>
        <button onClick={() => setAccountModalOpen(true)} className="relative w-9 h-9 rounded-full bg-[#737373] text-white font-semibold text-sm flex items-center justify-center">
          {(activeEmployee?.full_name || "A").charAt(0).toUpperCase()}
          <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500" : "bg-amber-400"}`} />
        </button>
      </header>

      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-base">Akun Aktif & Sinkronisasi</h3>
                <p className="text-xs text-slate-500">{isOnline ? "Terhubung ke Neon Cloud" : "Mode Offline Aktif"}</p>
              </div>
              <button onClick={() => setAccountModalOpen(false)} className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100">Tutup</button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {employees.map((emp) => (
                <button key={emp.id} onClick={() => { setSelectedEmpId(emp.id); localStorage.setItem(ACTIVE_EMP_KEY, String(emp.id)); setAccountModalOpen(false); }} className={`w-full flex items-center justify-between p-3 rounded-xl border text-left ${Number(selectedEmpId) === Number(emp.id) ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}>
                  <div>
                    <div className="font-bold text-sm">{emp.full_name}</div>
                    <div className="text-xs text-slate-500">{emp.emp_code} • {emp.role}</div>
                  </div>
                  {Number(selectedEmpId) === Number(emp.id) && <span className="text-xs font-bold text-orange-600">Aktif</span>}
                </button>
              ))}
            </div>
            {offlineQueue.length > 0 && (
              <button onClick={() => syncOfflineQueueToServer(offlineQueue)} disabled={!isOnline || isSyncing} className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-2">
                <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} /> Sinkronkan {offlineQueue.length} Data Offline
              </button>
            )}
          </div>
        </div>
      )}

      {mainTab === "beranda" && subView === "none" && (
        <div>
          <div className="bg-white border-b border-slate-200/80 px-5 py-3 flex items-center justify-between">
            <div className="grid grid-cols-2 flex-1 gap-4">
              <button onClick={() => setDateRangeMode((p) => (p === "Hari" ? "Minggu" : "Hari"))} className="text-left">
                <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">RENTANG TANGGAL</div>
                <div className="text-[15px] font-medium text-slate-800 mt-0.5">{dateRangeMode}</div>
              </button>
              <button onClick={() => setViewScope((p) => (p === "Organisasi" ? "Pribadi" : "Organisasi"))} className="text-left border-l border-slate-100 pl-4">
                <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">LIHAT</div>
                <div className="text-[15px] font-medium text-slate-800 mt-0.5">{viewScope}</div>
              </button>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <div className="p-4 space-y-4">
            <div onClick={() => setSubView("whosin")} className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-slate-100 cursor-pointer">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-slate-900">Siapa yang Masuk/Keluar</h2>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
              <div className="grid grid-cols-3 py-6 text-center">
                <div><div className="text-2xl font-bold text-slate-900">{whoIsInOutCounts.masuk}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">MASUK</div></div>
                <div><div className="text-2xl font-bold text-slate-900">{whoIsInOutCounts.istirahat}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">ISTIRAHAT</div></div>
                <div><div className="text-2xl font-bold text-slate-900">{whoIsInOutCounts.keluar}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">KELUAR</div></div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-slate-100">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-slate-900">Jam terlacak</h2>
                {!isOnline && <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Offline</span>}
              </div>
              <div className="grid grid-cols-3 py-5 text-center border-b border-slate-100">
                <div><div className="text-xl font-bold text-slate-900">{formatHM(weeklyChartData.summaryWorkSec)}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">BEKERJA</div></div>
                <div><div className="text-xl font-bold text-slate-900">{formatHM(weeklyChartData.summaryBreakSec)}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">ISTIRAHAT</div></div>
                <div><div className="text-xl font-bold text-slate-900">{formatHM(weeklyChartData.summaryOtSec)}</div><div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1">LEMBUR</div></div>
              </div>

              <div className="px-5 pt-4 pb-5">
                <div className="flex items-center mb-2">
                  <div className="w-7 shrink-0" />
                  <div className="flex-1 flex justify-between text-[11px] text-slate-400 font-medium pr-12">
                    {weeklyChartData.ticks.map((t) => <span key={t}>{Math.round(t)}</span>)}
                  </div>
                </div>
                <div className="relative space-y-3.5">
                  {weeklyChartData.bars.map((bar) => {
                    const widthPct = Math.min(100, ((bar.workSeconds / 3600) / weeklyChartData.axisMax) * 100);
                    return (
                      <div key={bar.dateStr} className="flex items-center h-7">
                        <div className={`w-7 shrink-0 text-xs ${bar.isToday ? "text-slate-900 font-bold" : "text-slate-600 font-semibold"}`}>{bar.label}</div>
                        <div className="flex-1 flex items-center h-full relative">
                          <div className="absolute inset-y-0 left-0 right-12 flex justify-between pointer-events-none">
                            {weeklyChartData.ticks.map((t) => <div key={t} className="w-px h-full bg-slate-100" />)}
                          </div>
                          {bar.workSeconds > 0 && (
                            <div className="relative z-10 flex items-center w-full pr-12">
                              <div style={{ width: `${Math.max(widthPct, 4)}%` }} className="h-7 bg-[#00C805] rounded-r-[3px]" />
                              <span className="ml-2.5 text-xs font-medium text-slate-600 whitespace-nowrap">{formatHM(bar.workSeconds)}</span>
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
          {employees.map((emp) => {
            const st = computeDayStats(emp.id, todayStr);
            const firstIn = st.entries.find((e) => e.entry_type === "CLOCK_IN");
            return (
              <div key={emp.id} className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {firstIn?.selfie_data ? <img src={firstIn.selfie_data} alt={emp.full_name} className="w-11 h-11 rounded-full object-cover border" /> : <div className="w-11 h-11 rounded-full bg-slate-200 font-bold flex items-center justify-center">{emp.full_name.charAt(0)}</div>}
                  <div>
                    <div className="font-bold text-sm">{emp.full_name}</div>
                    <div className="text-xs text-slate-500">{emp.department} • {firstIn ? `Masuk ${formatTimeWIB(firstIn.punched_at)}` : "Belum masuk"}</div>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${st.status === "IN" ? "bg-emerald-100 text-emerald-700" : st.status === "BREAK" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                  {st.status === "IN" ? "MASUK" : st.status === "BREAK" ? "ISTIRAHAT" : "KELUAR"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {mainTab === "timeclock" && subView === "none" && activeEmployee && activeEmpToday && (
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-100 text-center space-y-4">
            <div className="flex items-center justify-between text-left border-b border-slate-100 pb-3">
              <div><div className="text-xs text-slate-400 font-semibold">{activeEmployee.emp_code} • {activeEmployee.department}</div><div className="font-bold text-base">{activeEmployee.full_name}</div></div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${activeEmpToday.status === "IN" ? "bg-emerald-100 text-emerald-700" : activeEmpToday.status === "BREAK" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{activeEmpToday.status === "IN" ? "BEKERJA" : activeEmpToday.status === "BREAK" ? "ISTIRAHAT" : "KELUAR"}</span>
            </div>
            <div>
              <div className="text-xs text-slate-400">Durasi Hari Ini</div>
              <div className="text-4xl font-mono font-extrabold mt-1">{formatDuration(activeEmpToday.workSeconds)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(Number(e.target.value))} className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs bg-slate-50">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={selectedActivity} onChange={(e) => setSelectedActivity(e.target.value)} className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs bg-slate-50">
                <option value="Kerja Reguler">Kerja Reguler</option>
                <option value="Lapangan">Lapangan</option>
                <option value="Lembur">Lembur</option>
              </select>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between text-left text-xs border border-slate-100">
              <div className="flex items-center gap-2">
                <MapPin className={`w-4 h-4 ${nearestGeofence?.inside ? "text-emerald-600" : "text-amber-600"}`} />
                <div><div className="font-semibold">{nearestGeofence ? `${nearestGeofence.location.name} (${nearestGeofence.distance}m)` : gpsStatus}</div><div className="text-[11px] text-slate-400">{gpsStatus}</div></div>
              </div>
              <button onClick={refreshGPS} className="px-2.5 py-1 rounded-lg bg-white border font-semibold text-[11px]">Cek GPS</button>
            </div>
            <div className="text-left">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-orange-500" /> Selfie</span>
                {!cameraActive ? <button onClick={startCamera} className="text-xs font-bold text-orange-600">{capturedSelfie ? "Foto Ulang" : "Buka Kamera"}</button> : <button onClick={capturePhoto} className="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-xs font-bold">Ambil Foto</button>}
              </div>
              {cameraActive && <div className="w-36 h-36 mx-auto rounded-2xl overflow-hidden bg-black border-2 border-orange-500"><video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" /></div>}
              {capturedSelfie && !cameraActive && <img src={capturedSelfie} alt="Selfie" className="w-12 h-12 rounded-xl object-cover border" />}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <input type="text" placeholder="Catatan opsional..." value={punchNotes} onChange={(e) => setPunchNotes(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
            <div className="grid grid-cols-2 gap-2.5">
              {activeEmpToday.status === "OUT" && <button onClick={() => handleRecordPunch(activeEmployee.id, "CLOCK_IN")} className="col-span-2 py-3.5 rounded-2xl bg-[#00C805] text-white font-bold text-sm flex items-center justify-center gap-2"><Play className="w-4 h-4 fill-current" /> CLOCK IN</button>}
              {activeEmpToday.status === "IN" && (<><button onClick={() => handleRecord
