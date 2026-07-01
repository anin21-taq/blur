/**
 * handDetection.js
 * ---------------------------------------------------------------------------
 * Thin wrapper around MediaPipe Hands. Responsible ONLY for:
 *   1. Configuring the Hands model.
 *   2. Feeding video frames into it on every animation frame.
 *   3. Forwarding raw landmark results to whoever subscribes (app.js).
 *
 * This file has no knowledge of blur / audio / UI — that logic lives in
 * app.js so this module can be reused or swapped (e.g. for TF.js HandPose)
 * without touching gesture logic.
 * ---------------------------------------------------------------------------
 */

class HandDetector {
  /**
   * @param {HTMLVideoElement} videoEl - source video element (camera feed)
   * @param {Function} onResults - callback(results) fired every processed frame
   */
  constructor(videoEl, onResults) {
    this.videoEl = videoEl;
    this.onResults = onResults;
    this.running = false;
    this._rafId = null;

    // ---- Configure MediaPipe Hands ----
    this.hands = new Hands({
      // Load the wasm/model assets from the same CDN version as the script tags
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 1, // one hand is enough for this gesture
      modelComplexity: 1, // 0 = fastest / lite, 1 = full accuracy
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.6,
    });

    this.hands.onResults((results) => {
      if (this.onResults) this.onResults(results);
    });
  }

  /** Start the detection loop, pulling frames from the video element. */
  start() {
    if (this.running) return;
    this.running = true;

    const loop = async () => {
      if (!this.running) return;

      // Only send a frame once the video actually has data
      if (this.videoEl.readyState >= 2) {
        await this.hands.send({ image: this.videoEl });
      }

      this._rafId = requestAnimationFrame(loop);
    };

    loop();
  }

  /** Stop the detection loop (camera stream itself is managed in app.js). */
  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}

// Expose globally — app.js instantiates this.
window.HandDetector = HandDetector;
