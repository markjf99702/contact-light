// Every sound is made in the browser with Web Audio, with no sound files: the descent engine's rumble,
// the attitude jets, the rate switch, Houston's Quindar tones (2,525 Hz before a transmission and
// 2,475 Hz after, a quarter second each), the touchdown. The calls can be read aloud by the
// browser's own voice, if it has one.

let ac = null, master = null, noise = null, eng = null;
let soundOn = true, voiceOn = false;
let voices = [];

export function setSound(on) {
  soundOn = on;
  if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ac.currentTime, 0.05);
  if (!on) stopSpeech();
}
export function setVoice(on) {
  voiceOn = on;
  if (!on) stopSpeech();
  else loadVoices();
}
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Browsers only allow sound after the person has touched or pressed something.
export function unlock() {
  primeSpeech();
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = soundOn ? 0.8 : 0;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    // Brownish noise: random steps, kept from wandering off.
    let v = 0;
    for (let i = 0; i < d.length; i++) { v = (v + (Math.random() * 2 - 1) * 0.08) * 0.985; d[i] = v * 3; }
  }
  // Suspended until a tap allows it, or 'interrupted' on an iPhone after a call or a trip to the home
  // screen: either way, try again now.
  if (ac.state !== 'running' && ac.resume) Promise.resolve(ac.resume()).catch(() => {});
}

function out(node) { node.connect(master); }

function burst(t, dur, freq, q, gain, type = 'bandpass') {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const f = ac.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); out(g);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(t, freq, dur, gain, type = 'sine', attack = 0.004) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + dur - 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); out(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const live = () => ac && soundOn && ac.state === 'running';

// The engine: a low rumble that follows the throttle. level 0 stops it.
export function engine(level) {
  if (!ac) return;
  if (!eng && level > 0) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); out(g);
    src.start();
    eng = { src, f, g };
  }
  if (!eng) return;
  const now = ac.currentTime;
  eng.g.gain.setTargetAtTime(level > 0 ? 0.05 + level * 0.32 : 0, now, level > 0 ? 0.12 : 0.03);
  eng.f.frequency.setTargetAtTime(160 + level * 260, now, 0.15);
}

export function play(name) {
  if (!live()) return;
  const t = ac.currentTime + 0.005;
  switch (name) {
    case 'click': burst(t, 0.03, 2600, 3, 0.5); tone(t, 1800, 0.018, 0.08, 'square'); break;
    case 'jets': burst(t, 0.06, 3200, 1.2, 0.18, 'highpass'); break;
    case 'quindarIn': tone(t, 2525, 0.25, 0.07); break;
    case 'quindarOut': tone(t, 2475, 0.25, 0.07); break;
    case 'static': burst(t, 0.16, 1800, 0.6, 0.12); break;
    case 'lamp': tone(t, 880, 0.05, 0.05, 'triangle'); break;
    case 'contact': tone(t, 1320, 0.09, 0.06, 'sine'); tone(t + 0.09, 1760, 0.16, 0.05, 'sine'); break;
    case 'thud': burst(t, 0.35, 110, 0.8, 1.1, 'lowpass'); burst(t + 0.05, 0.25, 420, 1.2, 0.35); break;
    case 'hard': burst(t, 0.5, 90, 0.8, 1.4, 'lowpass'); burst(t, 0.3, 900, 1, 0.6); break;
    case 'crash': for (let k = 0; k < 5; k++) burst(t + k * 0.07, 0.4, 200 + k * 260, 0.9, 0.9 - k * 0.12); break;
    case 'abort': burst(t, 0.12, 300, 1, 1.0, 'lowpass'); burst(t + 0.1, 2.4, 700, 0.5, 0.5); break;
    case 'plaque': [523, 659, 784, 1047].forEach((f, k) => tone(t + k * 0.11, f, 0.5, 0.06, 'triangle')); break;
  }
}

// A line on the radio: Houston's come wrapped in Quindar tones, the crew's with a little static.
// Returns roughly how long it takes, in seconds.
export function radioLine(l) {
  if (live()) {
    if (l.quindar) play('quindarIn');
    else play('static');
  }
  const wait = l.quindar ? 0.28 : 0.1;
  const words = l.say.split(/\s+/).length;
  const dur = wait + words * 0.36;
  if (voiceOn && soundOn && canSpeak()) setTimeout(() => speak(l), wait * 1000);
  if (l.quindar && live()) {
    const end = voiceOn && canSpeak() ? dur + 0.25 : 0.9;
    setTimeout(() => play('quindarOut'), end * 1000);
  }
  return dur;
}

// iPhones only let a page speak once it has spoken during a tap, so say nothing, quietly, the first
// time there's a tap with the voice on; after that the calls can speak whenever they come.
let primed = false;
function primeSpeech() {
  if (primed || !voiceOn || !canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    primed = true;
  } catch { /* no voice: the words are on screen anyway */ }
}

function loadVoices() {
  if (!canSpeak()) return;
  voices = speechSynthesis.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang));
  if (!voices.length) speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang)); };
}

function speak(l) {
  try {
    // Don't let the calls pile up behind the voice: an old number is worse than none.
    if (speechSynthesis.speaking && l.numbers) return;
    if (speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(l.say);
    const us = voices.filter(v => /en-US/i.test(v.lang));
    const pool = us.length ? us : voices;
    if (pool.length) u.voice = pool[l.role === 'capcom' ? Math.min(1, pool.length - 1) : 0];
    u.rate = l.role === 'capcom' ? 1.05 : 1.12;
    u.pitch = l.role === 'capcom' ? 0.9 : l.role === 'cdr' ? 0.85 : 1;
    speechSynthesis.speak(u);
  } catch { /* no voice: the words are on screen anyway */ }
}

// A short buzz on phones that can (Android does, iPhones don't), when the sound is on.
export function buzz(pattern) {
  try { if (soundOn && navigator.vibrate) navigator.vibrate(pattern); } catch { /* not allowed: fine */ }
}

export function stopSpeech() {
  try { if (canSpeak()) speechSynthesis.cancel(); } catch { /* fine */ }
}
