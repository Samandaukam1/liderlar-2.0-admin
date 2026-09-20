"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * MEHR Mini App — TADBIR VOSITASI, ijtimoiy tarmoq emas.
 *
 * Bu ekran tadbir joyida, telefonda, ko'pincha shoshilinch
 * ochiladi. Shuning uchun har ekranda BITTA asosiy amal
 * bo'ladi va matn kam.
 */

interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  showScanQrPopup?: (
    params: { text?: string },
    callback: (text: string) => boolean | void,
  ) => void;
  closeScanQrPopup?: () => void;
  HapticFeedback?: { notificationOccurred: (t: "error" | "success" | "warning") => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type Screen = "loading" | "menu" | "organizer" | "create" | "live" | "scan" | "result";

interface Activity {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  requires_location: boolean;
}

interface LiveStatus {
  activity: { id: string; title: string; status: string; requiresLocation: boolean };
  session: { id: string; status: string; rotationSeconds: number } | null;
  checkedIn: number;
  locationVerifiedCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Qoralama",
  submitted: "Tekshiruvda",
  changes_requested: "Tuzatish so'ralgan",
  approved: "Tasdiqlangan",
  rejected: "Rad etilgan",
};

/*
 * Telegram `initData` ni tashqi manba sifatida o'qish.
 *
 * Qiymat bir marta o'rnatiladi va o'zgarmaydi, shuning uchun
 * obuna bo'sh. Qaytariladigan qiymat SATR — `useSyncExternalStore`
 * havolalarni solishtiradi va har chaqiruvda yangi obyekt
 * qaytarilsa, cheksiz qayta chizish boshlanardi.
 */
const SERVER_SNAPSHOT = "";
const NO_TELEGRAM = "__NO_TELEGRAM__";

function subscribeNever(): () => void {
  return () => {};
}

function readInitData(): string {
  return window.Telegram?.WebApp?.initData || NO_TELEGRAM;
}

function readInitDataOnServer(): string {
  return SERVER_SNAPSHOT;
}

export function MehrMiniApp({
  enabled,
  checkinEnabled,
  categories,
  regions,
}: {
  enabled: boolean;
  checkinEnabled: boolean;
  categories: { id: string; name: string }[];
  regions: { id: string; name: string }[];
}) {
  /*
   * TELEGRAM — TASHQI TIZIM, EFFEKT EMAS.
   *
   * `initData` ni effektda o'qib, setState bilan saqlash
   * vasvasa qiladi, lekin bu ekranni ikki marta chizadi va
   * birinchi so'rov imzosiz ketishi mumkin.
   *
   * `useSyncExternalStore` aynan shu uchun: server va mijoz
   * suratlari alohida beriladi, qiymat esa render paytida
   * darhol mavjud bo'ladi.
   */
  const initData = useSyncExternalStore(subscribeNever, readInitData, readInitDataOnServer);

  const [screen, setScreen] = useState<Screen>("menu");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [qr, setQr] = useState<{ dataUrl: string; expiresAt: number } | null>(null);
  /*
   * Sanoq ALOHIDA holatda turadi.
   *
   * Uni render paytida `Date.now()` bilan hisoblash vasvasa
   * qiladi, lekin bu sof bo'lmagan chaqiruv: React komponentni
   * qachon qayta chizishini kafolatlamaydi va raqam sakrab
   * qolardi. Soat esa taymerda, bir maromda yuradi.
   */
  const [secondsLeft, setSecondsLeft] = useState(0);

  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Telegram'ga "tayyorman" deyish — holatni o'zgartirmaydi.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
  }, []);

  const call = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`/api/mehr-app/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, initData }),
      });
      const json = (await response.json()) as Record<string, unknown>;
      return { ok: response.ok && json.ok === true, json };
    },
    [initData],
  );

  const loadActivities = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { ok, json } = await call("activity", { action: "list" });
    setBusy(false);
    if (!ok) {
      setError((json.error as string) ?? "Yuklab bo'lmadi.");
      return;
    }
    setActivities((json.activities as Activity[]) ?? []);
    setScreen("organizer");
  }, [call]);

  const loadLive = useCallback(
    async (activityId: string) => {
      const { ok, json } = await call("session", { action: "status", activityId });
      if (!ok) {
        setError((json.error as string) ?? "Holatni olib bo'lmadi.");
        return null;
      }
      const status = json as unknown as LiveStatus;
      setLive(status);
      return status;
    },
    [call],
  );

  /*
   * QR YANGILANISHI.
   *
   * Token qisqa muddatli, shuning uchun ekrandagi rasm ham
   * muntazam yangilanadi. Interval tokenning amal qilish
   * muddatidan QISQAROQ: aynan tugash paytida yangilansa,
   * odam o'lik kodni skanerlab ulgurardi.
   */
  const refreshQr = useCallback(
    async (sessionId: string) => {
      const { ok, json } = await call("session", { action: "qr", sessionId });
      if (!ok) {
        setError((json.error as string) ?? "QR olinmadi.");
        return;
      }
      const expiresAt = json.expiresAt as number;
      setQr({ dataUrl: json.dataUrl as string, expiresAt });
      setSecondsLeft(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));
    },
    [call],
  );

  const startLive = useCallback(
    async (activity: Activity) => {
      setBusy(true);
      setError(null);

      const open = await call("session", { action: "open", activityId: activity.id });
      setBusy(false);

      if (!open.ok) {
        setError((open.json.error as string) ?? "Seansni ochib bo'lmadi.");
        return;
      }

      const sessionId = open.json.sessionId as string;
      await loadLive(activity.id);
      await refreshQr(sessionId);
      setScreen("live");

      if (qrTimer.current) clearInterval(qrTimer.current);
      qrTimer.current = setInterval(() => {
        void refreshQr(sessionId);
        void loadLive(activity.id);
      }, 20_000);
    },
    [call, loadLive, refreshQr],
  );

  useEffect(() => {
    return () => {
      if (qrTimer.current) clearInterval(qrTimer.current);
    };
  }, []);

  /*
   * Effekt FAQAT taymerni o'rnatadi. Boshlang'ich qiymat QR
   * kelganda, `refreshQr` ichida qo'yiladi — u effekt tanasi
   * emas, hodisa ishlovchisi.
   */
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [qr]);

  const closeSession = useCallback(async () => {
    if (!live?.session) return;
    setBusy(true);
    const { ok, json } = await call("session", { action: "close", sessionId: live.session.id });
    setBusy(false);
    if (!ok) {
      setError((json.error as string) ?? "Yopib bo'lmadi.");
      return;
    }
    if (qrTimer.current) clearInterval(qrTimer.current);
    setQr(null);
    setNotice(`Tadbir yopildi. ${json.checkedIn as number} nafar qayd etildi.`);
    setScreen("result");
  }, [call, live]);

  /*
   * CHECK-IN.
   *
   * Telegram'ning o'z QR skaneri ishlatiladi: kamera ruxsati
   * va skanerlash mantig'i ilovaning o'zida, ishonchli va
   * sinalgan. Joylashuv esa FAQAT kerak bo'lganda so'raladi.
   */
  const submitCheckin = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setScreen("loading");

      let location: { latitude: number; longitude: number; accuracyMeters?: number } | null = null;

      try {
        location = await new Promise((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracyMeters: pos.coords.accuracy,
              }),
            // Rad etilsa ham davom etamiz: onlayn tadbirda joy kerak emas,
            // jismoniy tadbirda server buni o'zi aytadi.
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
          );
        });
      } catch {
        location = null;
      }

      const { ok, json } = await call("checkin", { token, location });
      setBusy(false);

      if (!ok) {
        setError((json.error as string) ?? "Qayd etilmadi.");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      } else {
        setNotice(
          `✅ Qayd etildingiz!\n\n${json.activityTitle as string}` +
            (json.locationVerified ? "\n\nJoylashuv tasdiqlandi." : ""),
        );
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      }
      setScreen("result");
    },
    [call],
  );

  /*
   * Skanerlash submitCheckin'dan KEYIN e'lon qilinadi: u shu
   * funksiyaga tayanadi va tartib buzilsa, bog'liqlik ro'yxati
   * ham noto'g'ri bo'lardi.
   */
  const scanAndCheckin = useCallback(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.showScanQrPopup) {
      setError("Telegram versiyangiz QR skanerni qo'llamaydi. Ilovani yangilang.");
      setScreen("result");
      return;
    }

    tg.showScanQrPopup({ text: "Tadbir QR kodini skanerlang" }, (text) => {
      tg.closeScanQrPopup?.();
      void submitCheckin(text);
      return true;
    });
  }, [submitCheckin]);

  // ----------------------------------------------------------

  if (initData === SERVER_SNAPSHOT) {
    return <Shell><p style={S.muted}>Yuklanmoqda…</p></Shell>;
  }

  if (initData === NO_TELEGRAM) {
    return (
      <Shell>
        <div style={S.error}>
          Bu sahifa Telegram ilovasi ichida ochilishi kerak.
        </div>
      </Shell>
    );
  }

  if (screen === "loading") {
    return <Shell><p style={S.muted}>Yuklanmoqda…</p></Shell>;
  }

  if (screen === "result") {
    return (
      <Shell>
        {error && <div style={S.error}>{error}</div>}
        {notice && <div style={S.success}>{notice}</div>}
        <button style={S.button} onClick={() => { setError(null); setNotice(null); setScreen("menu"); }}>
          Asosiy menyu
        </button>
      </Shell>
    );
  }

  if (screen === "menu") {
    return (
      <Shell>
        <h1 style={S.h1}>MEHR 365+</h1>
        {!enabled && (
          <div style={S.warn}>
            Tadbir yaratish hozircha yopiq — tizim sozlanmoqda.
          </div>
        )}
        {error && <div style={S.error}>{error}</div>}

        <button
          style={checkinEnabled ? S.button : S.buttonDisabled}
          disabled={!checkinEnabled}
          onClick={scanAndCheckin}
        >
          🙋 Tadbirga qo&apos;shilish
        </button>

        <button
          style={enabled ? S.buttonGhost : S.buttonDisabled}
          disabled={!enabled || busy}
          onClick={loadActivities}
        >
          ➕ Mening tadbirlarim
        </button>

        <p style={S.footnote}>
          Ball va sertifikat tadbir <b>admin tomonidan tasdiqlangandan keyin</b> beriladi.
        </p>
      </Shell>
    );
  }

  if (screen === "organizer") {
    return (
      <Shell>
        <h1 style={S.h1}>Mening tadbirlarim</h1>
        {error && <div style={S.error}>{error}</div>}

        <button style={S.button} onClick={() => setScreen("create")}>
          ➕ Yangi tadbir
        </button>

        {activities.length === 0 ? (
          <p style={S.muted}>Hozircha tadbir yo&apos;q.</p>
        ) : (
          activities.map((a) => (
            <div key={a.id} style={S.card}>
              <div style={{ fontWeight: 700 }}>{a.title}</div>
              <div style={S.muted}>{STATUS_LABEL[a.status] ?? a.status}</div>
              {(a.status === "draft" || a.status === "changes_requested") && (
                <button style={S.buttonSmall} disabled={busy} onClick={() => void startLive(a)}>
                  ▶️ Tadbirni boshlash
                </button>
              )}
            </div>
          ))
        )}

        <button style={S.buttonGhost} onClick={() => setScreen("menu")}>Orqaga</button>
      </Shell>
    );
  }

  if (screen === "live" && live) {

    return (
      <Shell>
        <h1 style={S.h1}>{live.activity.title}</h1>

        <div style={S.statRow}>
          <div style={S.stat}>
            <div style={S.statValue}>{live.checkedIn}</div>
            <div style={S.muted}>qayd etildi</div>
          </div>
          {live.activity.requiresLocation && (
            <div style={S.stat}>
              <div style={S.statValue}>{live.locationVerifiedCount}</div>
              <div style={S.muted}>joyi tasdiqlandi</div>
            </div>
          )}
        </div>

        {qr ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.dataUrl} alt="Tadbir QR kodi" style={S.qr} />
            <p style={S.muted}>
              Kod {secondsLeft > 0 ? `${secondsLeft} soniyada` : "hozir"} yangilanadi.
              Ishtirokchilar shu ekranni skanerlaydi.
            </p>
          </>
        ) : (
          <p style={S.muted}>QR tayyorlanmoqda…</p>
        )}

        {error && <div style={S.error}>{error}</div>}

        <button style={S.buttonDanger} disabled={busy} onClick={() => void closeSession()}>
          ⏹ Tadbirni yakunlash
        </button>
        <p style={S.footnote}>
          Yakunlagandan keyin dalillarni <b>shaxsiy kabinetdan</b> to&apos;ldirib,
          tekshiruvga yuborasiz.
        </p>
      </Shell>
    );
  }

  return (
    <CreateForm
      categories={categories}
      regions={regions}
      busy={busy}
      onCancel={() => setScreen("organizer")}
      onSubmit={async (payload) => {
        setBusy(true);
        setError(null);
        const { ok, json } = await call("activity", { action: "create", activity: payload });
        setBusy(false);
        if (!ok) {
          setError((json.error as string) ?? "Yaratib bo'lmadi.");
          return;
        }
        setNotice("Tadbir yaratildi. Endi uni boshlashingiz mumkin.");
        await loadActivities();
      }}
      error={error}
    />
  );
}

// ------------------------------------------------------------

interface CreatePayload {
  title: string;
  categoryId: string | null;
  regionId: string | null;
  purpose: string | null;
  locationName: string | null;
  requiresLocation: boolean;
  latitude: number | null;
  longitude: number | null;
  checkinRadiusMeters: number | null;
  startsAt: string | null;
  expectedParticipants: number | null;
}

function CreateForm({
  categories,
  regions,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  categories: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: CreatePayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [locationName, setLocationName] = useState("");
  const [online, setOnline] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(300);
  const [expected, setExpected] = useState("");
  const [geoBusy, setGeoBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  /*
   * MAS'ULIYAT KARTASI (§21).
   *
   * Tadbir ochishdan oldin odam nimaga rozi bo'layotganini
   * bilishi kerak: dalil talab qilinadi, ball faqat tasdiqdan
   * keyin, soxta dalil cheklovga olib keladi.
   */
  if (!accepted) {
    return (
      <Shell>
        <h1 style={S.h1}>Volontyorlik harakati</h1>
        <div style={S.card}>
          <p style={{ margin: "0 0 10px" }}>
            <b>MEHR 365+ ezgulik ishi</b> — bu haqiqiy, tekshiriladigan faoliyat.
          </p>
          <ul style={S.list}>
            <li>Tashkilotchi sifatida siz tadbir haqiqiyligiga javob berasiz.</li>
            <li>Ishtirokchilar QR orqali qayd etiladi — ro&apos;yxat qo&apos;lda yozilmaydi.</li>
            <li>Tadbirdan keyin <b>dalil</b> (rasm, tavsif, natija) talab qilinadi.</li>
            <li>Ball va sertifikat <b>faqat admin tasdig&apos;idan keyin</b> beriladi.</li>
            <li>Soxta dalil rad etishga va faoliyat cheklanishiga olib keladi.</li>
          </ul>
        </div>
        <button style={S.button} onClick={() => setAccepted(true)}>Tushunarli, boshlash</button>
        <button style={S.buttonGhost} onClick={onCancel}>Bekor qilish</button>
      </Shell>
    );
  }

  const canSubmit = title.trim().length >= 3 && (online || coords !== null);

  return (
    <Shell>
      <h1 style={S.h1}>Yangi tadbir</h1>
      {error && <div style={S.error}>{error}</div>}

      <label style={S.label}>Tadbir nomi *</label>
      <input style={S.input} value={title} onChange={(e) => setTitle(e.target.value)}
             placeholder="Masalan: Qishki yordam aksiyasi" />

      <label style={S.label}>Yo&apos;nalish</label>
      <select style={S.input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">— tanlang —</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label style={S.label}>Hudud</label>
      <select style={S.input} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
        <option value="">— tanlang —</option>
        {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>

      <label style={S.label}>Maqsad</label>
      <textarea style={{ ...S.input, minHeight: 70 }} value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Nima uchun o'tkazilyapti?" />

      <label style={S.checkboxRow}>
        <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
        <span>Onlayn / joydan mustaqil tadbir</span>
      </label>

      {!online && (
        <>
          <label style={S.label}>Joy nomi</label>
          <input style={S.input} value={locationName} onChange={(e) => setLocationName(e.target.value)}
                 placeholder="Masalan: 12-maktab" />

          <button
            style={S.buttonGhost}
            disabled={geoBusy}
            onClick={() => {
              setGeoBusy(true);
              navigator.geolocation?.getCurrentPosition(
                (pos) => {
                  setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
                  setGeoBusy(false);
                },
                () => setGeoBusy(false),
                { enableHighAccuracy: true, timeout: 10_000 },
              );
            }}
          >
            {coords ? "📍 Joy belgilandi" : geoBusy ? "Aniqlanmoqda…" : "📍 Hozirgi joyni belgilash"}
          </button>

          <label style={S.label}>Ruxsat etilgan masofa: {radius} m</label>
          <input type="range" min={50} max={2000} step={50} value={radius}
                 onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }} />
        </>
      )}

      <label style={S.label}>Kutilayotgan ishtirokchilar</label>
      <input style={S.input} type="number" inputMode="numeric" value={expected}
             onChange={(e) => setExpected(e.target.value)} placeholder="0" />

      <button
        style={canSubmit && !busy ? S.button : S.buttonDisabled}
        disabled={!canSubmit || busy}
        onClick={() =>
          void onSubmit({
            title: title.trim(),
            categoryId: categoryId || null,
            regionId: regionId || null,
            purpose: purpose.trim() || null,
            locationName: locationName.trim() || null,
            requiresLocation: !online,
            latitude: online ? null : (coords?.lat ?? null),
            longitude: online ? null : (coords?.lon ?? null),
            checkinRadiusMeters: online ? null : radius,
            startsAt: new Date().toISOString(),
            expectedParticipants: expected ? Number(expected) : null,
          })
        }
      >
        Tadbirni yaratish
      </button>

      {!canSubmit && !online && (
        <p style={S.footnote}>Jismoniy tadbir uchun joyni belgilang yoki «onlayn» ni tanlang.</p>
      )}

      <button style={S.buttonGhost} onClick={onCancel}>Bekor qilish</button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={S.shell}>{children}</div>;
}

/*
 * Uslublar inline: Mini App admin panelning Tailwind qatlamidan
 * tashqarida ochiladi va bu ekran tadbir joyida, zaif internetda
 * darhol chizilishi kerak.
 */
const S: Record<string, React.CSSProperties> = {
  shell: {
    maxWidth: 520, margin: "0 auto", padding: "20px 16px 40px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "var(--tg-theme-text-color, #0b3555)",
    background: "var(--tg-theme-bg-color, #ffffff)",
    minHeight: "100vh", display: "flex", flexDirection: "column", gap: 12,
  },
  h1: { fontSize: 22, fontWeight: 800, margin: "0 0 4px" },
  label: { fontSize: 13, fontWeight: 600, marginTop: 8 },
  input: {
    width: "100%", padding: "11px 12px", fontSize: 16, borderRadius: 10,
    border: "1px solid rgba(12,151,192,0.35)", background: "#fff", color: "#0b3555",
    boxSizing: "border-box",
  },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 15, marginTop: 10 },
  button: {
    width: "100%", padding: "14px 16px", fontSize: 16, fontWeight: 700,
    borderRadius: 12, border: "none", background: "#13bce4", color: "#fff", cursor: "pointer",
  },
  buttonGhost: {
    width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 600,
    borderRadius: 12, border: "1px solid rgba(12,151,192,0.35)",
    background: "transparent", color: "#0b3555", cursor: "pointer",
  },
  buttonSmall: {
    marginTop: 8, padding: "9px 14px", fontSize: 14, fontWeight: 700,
    borderRadius: 10, border: "none", background: "#13bce4", color: "#fff", cursor: "pointer",
  },
  buttonDanger: {
    width: "100%", padding: "14px 16px", fontSize: 16, fontWeight: 700,
    borderRadius: 12, border: "none", background: "#c43d3d", color: "#fff", cursor: "pointer",
  },
  buttonDisabled: {
    width: "100%", padding: "14px 16px", fontSize: 16, fontWeight: 700,
    borderRadius: 12, border: "none", background: "#cfd8dd", color: "#7c8a92", cursor: "not-allowed",
  },
  card: {
    padding: 14, borderRadius: 12, border: "1px solid rgba(12,151,192,0.25)", background: "#f7fdff",
  },
  list: { margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 },
  muted: { fontSize: 13, color: "#617b8d", margin: "4px 0" },
  footnote: { fontSize: 12, color: "#617b8d", lineHeight: 1.5 },
  error: {
    padding: 12, borderRadius: 10, background: "rgba(196,61,61,0.1)",
    border: "1px solid rgba(196,61,61,0.35)", color: "#9b2c2c", fontSize: 14, whiteSpace: "pre-line",
  },
  success: {
    padding: 14, borderRadius: 10, background: "rgba(46,125,68,0.1)",
    border: "1px solid rgba(46,125,68,0.35)", color: "#2e7d44", fontSize: 15,
    fontWeight: 600, whiteSpace: "pre-line",
  },
  warn: {
    padding: 12, borderRadius: 10, background: "rgba(148,106,16,0.1)",
    border: "1px solid rgba(148,106,16,0.3)", color: "#946a10", fontSize: 14,
  },
  qr: {
    width: "100%", maxWidth: 320, alignSelf: "center", borderRadius: 14,
    border: "6px solid #fff", boxShadow: "0 4px 18px rgba(0,0,0,0.12)",
  },
  statRow: { display: "flex", gap: 12 },
  stat: {
    flex: 1, padding: 14, borderRadius: 12, textAlign: "center",
    border: "1px solid rgba(12,151,192,0.25)", background: "#f7fdff",
  },
  statValue: { fontSize: 30, fontWeight: 800, lineHeight: 1 },
};
