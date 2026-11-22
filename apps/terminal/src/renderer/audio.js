'use strict';
// Records the system sound ("loopback", what the speakers play) and reports 96 frequency bands, 0..1,
// spread logarithmically from 40 Hz to 16 kHz like cava. Started by Prism with a simulated click.
async function start() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach(t => t.stop()); // only the sound is needed
    if (!stream.getAudioTracks().length) throw new Error('Windows did not give Prism any sound to listen to.');
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 4096; an.smoothingTimeConstant = 0.55; an.minDecibels = -85; an.maxDecibels = -20;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.frequencyBinCount), N = 96, hz = ctx.sampleRate / an.fftSize;
    const edges = Array.from({ length: N + 1 }, (_, i) => Math.max(1, Math.round(40 * Math.pow(16000 / 40, i / N) / hz)));
    setInterval(() => {
      an.getByteFrequencyData(data);
      const bands = new Array(N);
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let k = edges[i]; k <= Math.max(edges[i], edges[i + 1] - 1) && k < data.length; k++) if (data[k] > m) m = data[k];
        bands[i] = Math.round(Math.pow(m / 255, 1.4) * 1000) / 1000;
      }
      window.audio.bands(bands);
    }, 33);
  } catch (e) {
    window.audio.error(/permission|denied|NotAllowed/i.test(String(e)) ? 'Windows did not let Prism listen to the sound.' : /NotFound|no audio|device/i.test(String(e)) ? 'No sound device found.' : String(e.message || e));
  }
}
