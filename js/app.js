/**
 * app.js
 * ---------------------------------------------------------------------------
 * Orchestrates the whole experience:
 *   - Camera permission flow
 *   - Wiring HandDetector -> gesture state machine
 *   - Cinematic effects: flash -> blur -> glow, with cooldown-gated audio
 *   - HUD updates (status dot, gesture label, FPS)
 * ---------------------------------------------------------------------------
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const permissionScreen = document.getElementById("permissionScreen");
  const enableCameraBtn = document.getElementById("enableCameraBtn");
  const permissionError = document.getElementById("permissionError");

  const stage = document.getElementById("stage");
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlayCanvas");
  const ctx = canvas.getContext("2d");
  const cameraWrap = document.getElementById("cameraWrap");
  const flashEl = document.getElementById("flash");

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const gestureState = document.getElementById("gestureState");
  const fpsCounter = document.getElementById("fpsCounter");
  const muteBtn = document.getElementById("muteBtn");

  const blurSound = document.getElementById("blurSound");

  // ---------------------------------------------------------------------
  // Tunable gesture parameters
  // ---------------------------------------------------------------------
  const RAISE_THRESHOLD = 0.38; // landmark.y below this => "raised" (near top of frame)
  const LOWER_THRESHOLD = 0.46; // landmark.y above this => "lowered" (hysteresis gap avoids flicker)
  const SMOOTHING = 0.35; // exponential moving average factor for the y coordinate
  const AUDIO_COOLDOWN_MS = 2000; // min gap between sound plays
  const FLASH_TO_BLUR_DELAY_MS = 130; // let the white flash pop before blur kicks in

  // ---------------------------------------------------------------------
  // Mutable state
  // ---------------------------------------------------------------------
  let smoothedY = null; // EMA of the tracked hand-y position
  let handRaised = false; // current debounced gesture state
  let cooldownUntil = 0; // timestamp until which audio is gated
  let isMuted = false;

  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fpsWindowStart = performance.now();

  // ===========================================================================
  // 1. CAMERA PERMISSION FLOW
  // ===========================================================================
  enableCameraBtn.addEventListener("click", async () => {
    enableCameraBtn.disabled = true;
    enableCameraBtn.textContent = "Meminta izin…";
    permissionError.hidden = true;

    try {
      // Ask for the camera stream directly (front camera preferred on mobile)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      video.srcObject = stream;
      await video.play();

      // "Warm up" the audio element inside this user-gesture click handler so
      // later programmatic .play() calls are allowed by autoplay policies.
      primeAudio();

      // Camera granted -> swap screens
      permissionScreen.hidden = true;
      stage.hidden = false;

      resizeCanvasToVideo();
      window.addEventListener("resize", resizeCanvasToVideo);

      startDetection();
    } catch (err) {
      console.error("Camera permission error:", err);
      permissionError.textContent =
        "Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan lalu coba lagi.";
      permissionError.hidden = false;
      enableCameraBtn.disabled = false;
      enableCameraBtn.textContent = "Aktifkan Kamera";
    }
  });

  /** Plays + immediately pauses the audio once, unlocking autoplay for later. */
  function primeAudio() {
    blurSound.volume = 1.0;
    const p = blurSound.play();
    if (p && p.then) {
      p.then(() => {
        blurSound.pause();
        blurSound.currentTime = 0;
      }).catch(() => {
        /* Some browsers still block this — later plays are triggered
           from the same gesture-derived flow, so it's usually fine. */
      });
    }
  }

  // ===========================================================================
  // 2. CANVAS SIZING (landmark overlay must match displayed video size)
  // ===========================================================================
  function resizeCanvasToVideo() {
    canvas.width = cameraWrap.clientWidth;
    canvas.height = cameraWrap.clientHeight;
  }

  // ===========================================================================
  // 3. START HAND DETECTION
  // ===========================================================================
  function startDetection() {
    const detector = new HandDetector(video, onHandResults);
    detector.start();
  }

  // ===========================================================================
  // 4. PER-FRAME RESULTS HANDLER
  // ===========================================================================
  function onHandResults(results) {
    updateFps();
    drawLandmarks(results);

    const hasHand =
      results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    updateTrackingStatus(hasHand);

    if (!hasHand) {
      smoothedY = null;
      return;
    }

    // Use the middle-finger MCP joint (landmark #9) as a stable "palm center" point
    const landmarks = results.multiHandLandmarks[0];
    const palmY = landmarks[9].y;

    // Exponential moving average to reduce per-frame jitter
    smoothedY = smoothedY === null ? palmY : smoothedY + (palmY - smoothedY) * SMOOTHING;

    evaluateGesture(smoothedY);
  }

  function updateTrackingStatus(hasHand) {
    if (hasHand) {
      statusDot.classList.add("tracking");
      statusText.textContent = "TANGAN TERDETEKSI";
    } else {
      statusDot.classList.remove("tracking");
      statusDot.classList.remove("raised");
      statusText.textContent = "MENCARI TANGAN…";
    }
  }

  // ===========================================================================
  // 5. GESTURE STATE MACHINE (hysteresis threshold + edge-triggered effects)
  // ===========================================================================
  function evaluateGesture(y) {
    if (!handRaised && y < RAISE_THRESHOLD) {
      // Hand just crossed UP past the shoulder line
      handRaised = true;
      onHandRaised();
    } else if (handRaised && y > LOWER_THRESHOLD) {
      // Hand just crossed back DOWN below the release line
      handRaised = false;
      onHandLowered();
    }
  }

  function onHandRaised() {
    gestureState.textContent = "TERANGKAT";
    gestureState.classList.add("raised");
    statusDot.classList.add("raised");

    // Cinematic flash, THEN blur fades in
    fireFlash();
    setTimeout(() => setBlurActive(true), FLASH_TO_BLUR_DELAY_MS);

    // Audio: only play if the 2s cooldown window has elapsed
    const now = Date.now();
    if (now >= cooldownUntil) {
      playBlurSound();
      cooldownUntil = now + AUDIO_COOLDOWN_MS;
    }
  }

  function onHandLowered() {
    gestureState.textContent = "NETRAL";
    gestureState.classList.remove("raised");
    statusDot.classList.remove("raised");

    // Blur fades out smoothly; no sound on release
    setBlurActive(false);
  }

  // ===========================================================================
  // 6. VISUAL EFFECTS: flash, blur, glow (all CSS-driven for smooth 60fps)
  // ===========================================================================
  function fireFlash() {
    flashEl.classList.remove("fire");
    // Force reflow so the animation can restart if triggered again quickly
    void flashEl.offsetWidth;
    flashEl.classList.add("fire");
  }

  function setBlurActive(active) {
    video.classList.toggle("is-blurred", active);
    stage.classList.toggle("is-blurred", active);
    cameraWrap.classList.toggle("is-active", active);
  }

  // ===========================================================================
  // 7. AUDIO
  // ===========================================================================
  function playBlurSound() {
    if (isMuted) return;
    try {
      blurSound.currentTime = 0;
      blurSound.play().catch((err) => console.warn("Audio play blocked:", err));
    } catch (err) {
      console.warn("Audio play error:", err);
    }
  }

  muteBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    muteBtn.setAttribute("aria-pressed", String(isMuted));
    muteBtn.textContent = isMuted ? "🔇 SUARA OFF" : "🔊 SUARA ON";
  });

  // ===========================================================================
  // 8. LANDMARK OVERLAY (subtle dot/line skeleton drawn on the canvas)
  // ===========================================================================
  function drawLandmarks(results) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks) return;

    for (const landmarks of results.multiHandLandmarks) {
      if (window.drawConnectors && window.HAND_CONNECTIONS) {
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
          color: "rgba(94, 234, 212, 0.55)",
          lineWidth: 2,
        });
      }
      if (window.drawLandmarks) {
        drawLandmarksFn(landmarks);
      }
    }
  }

  function drawLandmarksFn(landmarks) {
    ctx.save();
    for (const point of landmarks) {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    }
    ctx.restore();
  }

  // ===========================================================================
  // 9. FPS COUNTER (updates HUD roughly twice a second)
  // ===========================================================================
  function updateFps() {
    frameCount += 1;
    const now = performance.now();
    const elapsed = now - fpsWindowStart;

    if (elapsed >= 500) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      fpsCounter.textContent = `${fps} FPS`;
      frameCount = 0;
      fpsWindowStart = now;
    }
    lastFrameTime = now;
  }
})();
