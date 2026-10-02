// Earmark: measures sound through the phone's microphone and tracks your daily noise dose, so you know when to step out.
import { useEffect, useRef, useState } from "react";
import { uid, useStored } from "./lib/store";
import { todayISO } from "./lib/time";
import { Section, Stat, Stats } from "./ui/kit";

const T = "earmark";
type Chunk = { id: string; date: string; label: string; db: number; minutes: number };
// NIOSH: 85 dB for 8 hours is 100% of a day's safe dose; every 3 dB more halves the safe time.
const safeMinutes = (db: number) => 480 / Math.pow(2, (db - 85) / 3);
const dosePct = (db: number, minutes: number) => (db < 70 ? 0 : (minutes / safeMinutes(db)) * 100);
const fmtMin = (m: number) => (m >= 120 ? `${(m / 60).toFixed(1)} h` : m >= 1 ? `${Math.round(m)} min` : `${Math.round(m * 60)} s`);
const PRESETS: [string, number][] = [["Busy street", 80], ["Restaurant at peak", 85], ["Motorbike", 95], ["Nightclub", 100], ["Concert, front rows", 110], ["Workshop with power tools", 98]];

export default function Earmark() {
  const [chunks, setChunks] = useStored<Chunk[]>(T, "chunks", [{ id: "c1", date: todayISO(), label: "Commute on the metro", db: 82, minutes: 50 }, { id: "c2", date: todayISO(), label: "Band rehearsal", db: 94, minutes: 30 }]);
  const [offset, setOffset] = useStored(T, "offset", 100);
  const [live, setLive] = useState<{ db: number; peak: number; secs: number; dose: number; sum: number } | null>(null);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState({ label: "", db: 90, minutes: "60" });
  const stopRef = useRef<() => void>(() => {});
  const today = chunks.filter(c => c.date === todayISO());
  const doseToday = today.reduce((a, c) => a + dosePct(c.db, c.minutes), 0) + (live?.dose ?? 0);
  const remaining = (db: number) => Math.max(0, (safeMinutes(db) * (100 - doseToday)) / 100);

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 2048; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let last = performance.now(), secs = 0, dose = 0, sum = 0, peak = 0, raf = 0;
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
        const db = Math.max(30, 20 * Math.log10(rms || 1e-9) + offset);
        const now = performance.now(), dt = (now - last) / 1000; last = now;
        secs += dt; dose += db >= 70 ? (dt / 60 / safeMinutes(db)) * 100 : 0; sum += Math.pow(10, db / 10) * dt; peak = Math.max(peak, db);
        setLive({ db, peak, secs, dose, sum });
        raf = requestAnimationFrame(loop);
      };
      loop();
      stopRef.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ctx.close(); };
    } catch { setErr("The microphone is blocked. Allow it in the browser settings, or add sessions by hand below."); }
  };
  const stop = () => {
    stopRef.current();
    if (live && live.secs > 5) { const leq = 10 * Math.log10(live.sum / live.secs); setChunks([{ id: uid(), date: todayISO(), label: "Measured session", db: Math.round(leq), minutes: Math.round((live.secs / 60) * 10) / 10 }, ...chunks]); }
    setLive(null);
  };
  useEffect(() => () => stopRef.current(), []);
  const color = (db: number) => (db >= 100 ? "var(--bad)" : db >= 85 ? "var(--warn)" : "var(--good)");

  return (
    <div className="stack">
      <Section title="Today's noise dose">
        <div className="em-dose"><span style={{ width: `${Math.min(100, doseToday)}%`, background: doseToday >= 100 ? "var(--bad)" : doseToday >= 60 ? "var(--warn)" : "var(--good)" }} /><b className="num">{Math.round(doseToday)}%</b></div>
        <Stats><Stat value={doseToday >= 100 ? "Over the limit" : fmtMin(remaining(95))} label="Left at 95 dB (a loud bar)" tone={doseToday >= 100 ? "bad" : undefined} /><Stat value={doseToday >= 100 ? "–" : fmtMin(remaining(85))} label="Left at 85 dB (busy traffic)" /><Stat value={today.length} label="Sessions today" /></Stats>
        {doseToday >= 100 && <p className="pill bad" style={{ marginTop: 10 }}>You have used today's safe dose. Step outside, use earplugs, or leave early.</p>}
      </Section>

      <section className="panel em-meter">
        {live ? <>
          <div className="em-big num" style={{ color: color(live.db) }}>{Math.round(live.db)}<small>dB</small></div>
          <div className="em-gauge"><span style={{ width: `${Math.min(100, Math.max(0, (live.db - 40) / 80) * 100)}%`, background: color(live.db) }} /></div>
          <p className="note">Peak {Math.round(live.peak)} dB · {fmtMin(live.secs / 60)} measured · this session {live.dose.toFixed(1)}% of the daily dose</p>
          <button className="btn primary" onClick={stop}>Stop and save</button>
        </> : <>
          <p>Measure where you are. Keep the phone out of your pocket, microphone facing the sound.</p>
          <button className="btn primary em-go" onClick={start}>Start measuring</button>
          {err && <p className="pill bad">{err}</p>}
        </>}
      </section>

      <div className="grid2">
        <Section title="Add a session by hand">
          <form className="stack" style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); setChunks([{ id: uid(), date: todayISO(), label: manual.label || "Noisy place", db: manual.db, minutes: parseFloat(manual.minutes) || 0 }, ...chunks]); setManual({ ...manual, label: "" }); }}>
            <div className="row" style={{ gap: 6 }}>{PRESETS.map(([l, db]) => <button type="button" key={l} className="btn small" onClick={() => setManual({ ...manual, label: l, db })}>{l}</button>)}</div>
            <div className="row" style={{ alignItems: "flex-end" }}><label className="field"><span>What</span><input id="em-l" className="input" value={manual.label} onChange={e => setManual({ ...manual, label: e.target.value })} /></label><label className="field" style={{ flex: "0 0 90px" }}><span>dB</span><input id="em-db" className="input num" value={manual.db} onChange={e => setManual({ ...manual, db: parseInt(e.target.value) || 0 })} /></label><label className="field" style={{ flex: "0 0 90px" }}><span>Minutes</span><input id="em-m" className="input num" value={manual.minutes} onChange={e => setManual({ ...manual, minutes: e.target.value })} /></label><button className="btn primary" type="submit">Add</button></div>
            <p className="note">At {manual.db} dB the whole day's safe dose is used in {fmtMin(safeMinutes(manual.db))}.</p>
          </form>
        </Section>
        <Section title="Sessions">
          {chunks.slice(0, 20).map(c => <div key={c.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", alignItems: "center" }}><span style={{ flex: 1 }}>{c.label} <span className="note">{c.date}</span></span><span className="pill" style={{ color: color(c.db) }}>{c.db} dB · {fmtMin(c.minutes)}</span><span className="num" style={{ width: 52, textAlign: "right" }}>{Math.round(dosePct(c.db, c.minutes))}%</span><button className="btn ghost small danger" onClick={() => setChunks(chunks.filter(x => x.id !== c.id))}>×</button></div>)}
        </Section>
      </div>
      <Section title="Calibrate">
        <p className="note" style={{ marginBottom: 8 }}>Phone microphones differ. Next to a sound level meter, or a known 94 dB calibrator, adjust until the readings match. Without calibration, treat readings as roughly ±5 dB.</p>
        <label className="field" style={{ maxWidth: 320 }}><span>Microphone offset: {offset}</span><input id="em-off" type="range" min={70} max={130} value={offset} onChange={e => setOffset(+e.target.value)} /></label>
        <p className="note" style={{ marginTop: 8 }}>Uses the NIOSH rule: 85 dB for 8 hours is a full day's dose, and each 3 dB more halves the safe time. This is an awareness tool, not a certified measurement.</p>
      </Section>
      <style>{`.em-dose{position:relative;height:28px;background:var(--sunk);border-radius:14px;overflow:hidden;margin-bottom:16px}.em-dose span{display:block;height:100%}.em-dose b{position:absolute;right:12px;top:3px}
      .em-meter{text-align:center;display:grid;gap:12px;justify-items:center}.em-big{font-family:var(--serif);font-size:110px;line-height:1}.em-big small{font-size:28px;margin-left:6px}.em-gauge{width:100%;max-width:520px;height:14px;background:var(--sunk);border-radius:7px;overflow:hidden}.em-gauge span{display:block;height:100%;transition:width .1s}.em-go{font-size:20px;padding:18px 28px}`}</style>
    </div>
  );
}
