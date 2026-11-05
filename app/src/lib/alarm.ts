// Loud SOS alarm: a siren through the speaker plus vibration. Phones only allow sound after the person has tapped
// something once, so the store phone taps "Turn on alarm" when it opens Compass.
let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let sirenTimer: number | undefined;
let buzzTimer: number | undefined;
let unlocked = false;
let wake: WakeLockSentinel | null = null;

export const alarmUnlocked = () => unlocked;

export function unlockAlarm(): boolean {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ||= new AC();
    void ctx.resume();
    // A silent blip so the browser treats audio as allowed.
    const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05);
    unlocked = true;
  } catch { unlocked = false; }
  return unlocked;
}

export function startAlarm() {
  if (osc) return;
  if (ctx) {
    void ctx.resume();
    osc = ctx.createOscillator(); gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 880; gain.gain.value = 0.5;
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    let hi = true;
    sirenTimer = window.setInterval(() => { if (osc && ctx) { osc.frequency.setValueAtTime(hi ? 660 : 990, ctx.currentTime); hi = !hi; } }, 380);
  }
  const buzz = () => { try { navigator.vibrate?.([500, 200, 500, 200, 500]); } catch { /* not supported */ } };
  buzz();
  buzzTimer = window.setInterval(buzz, 2200);
}

export function stopAlarm() {
  window.clearInterval(sirenTimer); window.clearInterval(buzzTimer);
  sirenTimer = undefined; buzzTimer = undefined;
  try { osc?.stop(); } catch { /* already stopped */ }
  osc?.disconnect(); gain?.disconnect(); osc = null; gain = null;
  try { navigator.vibrate?.(0); } catch { /* not supported */ }
}

export function testBeep() {
  if (!ctx) return;
  void ctx.resume();
  const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.4;
  o.type = 'square'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.5);
  try { navigator.vibrate?.(300); } catch { /* not supported */ }
}

// Keep the screen on so the alarm can ring on the store phone.
export async function keepAwake(on: boolean) {
  try {
    if (on) { if (!wake && 'wakeLock' in navigator) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }
    else { await wake?.release(); wake = null; }
  } catch { /* not allowed right now */ }
}
