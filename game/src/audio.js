// NEON HARBOR — synthesised sound. Every sound is built live with the
// WebAudio API: no audio files, no network. The audio context is created
// only after the first user gesture, as browsers require. Mute toggles a
// master gain; the setting is saved with the game.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let muted = false;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = null;
  let bassTimer = null;
  let bassStep = 0;

  // A minor-ish bass line for the start screen, in Hz (A1, C2, E2, G1...).
  const BASS_LINE = [55, 55, 65.41, 55, 82.41, 55, 65.41, 49];

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  // Short burst of filtered noise — the raw material for shots and thuds.
  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function tone(freq, duration, type, gainValue, slideTo) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    // Call from any click/key handler so the context is allowed to start.
    unlock() {
      ensure();
    },
    setMuted(m) {
      muted = m;
      if (master && ctx) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    click() {
      tone(880, 0.07, 'square', 0.08, 660);
    },
    gunshot() {
      noiseBurst(0.14, 1800, 0.5, 'lowpass');
      tone(160, 0.09, 'square', 0.25, 60);
    },
    pickup() {
      tone(987.77, 0.1, 'sine', 0.22);
      setTimeout(() => tone(1318.5, 0.16, 'sine', 0.22), 80);
    },
    crash(strength = 1) {
      noiseBurst(0.22, 400, 0.35 * Math.min(1, strength));
      tone(90, 0.2, 'sine', 0.3 * Math.min(1, strength), 40);
    },
    punch() {
      noiseBurst(0.08, 700, 0.25);
    },
    splash() {
      noiseBurst(0.4, 900, 0.3, 'bandpass');
    },
    explosion() {
      noiseBurst(0.7, 300, 0.6);
      tone(70, 0.6, 'sine', 0.5, 30);
    },
    // Continuous engine hum. Call every frame with speedRatio 0..1 while
    // driving, and engineStop() when leaving the car.
    engine(speedRatio, running) {
      if (!ensure()) return;
      if (!engineOsc1) {
        engineOsc1 = ctx.createOscillator();
        engineOsc1.type = 'sawtooth';
        engineOsc2 = ctx.createOscillator();
        engineOsc2.type = 'square';
        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 500;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engineOsc1.connect(engineFilter);
        engineOsc2.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        engineOsc1.start();
        engineOsc2.start();
      }
      const target = running ? 0.05 + speedRatio * 0.06 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      const freq = 45 + speedRatio * 130;
      engineOsc1.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
      engineOsc2.frequency.setTargetAtTime(freq * 1.5 + 2, ctx.currentTime, 0.05);
      engineFilter.frequency.setTargetAtTime(300 + speedRatio * 900, ctx.currentTime, 0.1);
    },
    engineStop() {
      if (engineGain && ctx) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    // Two-tone police siren (stage 2 wires this to chasing cruisers).
    sirenStart() {
      if (!ensure() || sirenOsc) return;
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0.06;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      let high = false;
      sirenTimer = setInterval(() => {
        if (!sirenOsc) return;
        high = !high;
        sirenOsc.frequency.setTargetAtTime(high ? 950 : 700, ctx.currentTime, 0.05);
      }, 380);
    },
    sirenStop() {
      if (sirenTimer) clearInterval(sirenTimer);
      sirenTimer = null;
      if (sirenOsc) {
        try { sirenOsc.stop(); } catch { /* already stopped */ }
        sirenOsc = null;
      }
    },
    // Start-screen bass loop.
    bassStart() {
      if (!ensure() || bassTimer) return;
      bassTimer = setInterval(() => {
        if (muted) return;
        const freq = BASS_LINE[bassStep % BASS_LINE.length];
        bassStep++;
        tone(freq, 0.32, 'triangle', 0.16);
      }, 340);
    },
    bassStop() {
      if (bassTimer) clearInterval(bassTimer);
      bassTimer = null;
    },
  };
}
