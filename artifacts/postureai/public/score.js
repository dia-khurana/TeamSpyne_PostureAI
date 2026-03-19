// PostureAI — Score Pipeline v4
// Fixed: head roll and shoulder now correctly penalise score
// Added: sound nudge system, "fixed it" detection, posture time tracking

window.postureCV = window.postureCV || {
  neckAngle: 0,
  shoulderAngle: 0,
  spineAngle: 0,
  headRoll: 0,
  status: "good",
};

window.postureScore = {
  composite: 0,
  neck: 0,
  shoulder: 0,
  spine: 0,
  headRoll: 0,
  status: "NO_POSE",
  color: "green",
  muscleRisk: "",
  exerciseTip: "",
  earlyWarning: false,
  badStreak: 0,
  forwardHeadDepth: 0,
  lumbarScore: 100,
  // Posture time tracking
  goodSecs: 0,
  fairSecs: 0,
  badSecs: 0,
  // Fixed it detection
  justFixed: false,
};

let _scoreHistory = [];
let _elapsed = 0;
let _elapsedTimer = null;
let _badStreak = 0;
let _prevBad = false; // was bad last tick
let _goodSecs = 0;
let _fairSecs = 0;
let _badSecs = 0;

// ── Audio context for nudge sounds ───────────────────────────────────────────
let _audioCtx = null;
let _muted = false;

window.setPostureAIMuted = function (muted) {
  _muted = muted;
};

function getAudioCtx() {
  if (!_audioCtx)
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

// Gentle chime — two-tone pleasant sound
function playNudge() {
  if (_muted) return;
  try {
    const ctx = getAudioCtx();
    [440, 550].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch (e) {}
}

// Positive chime — "fixed it" sound
function playFixed() {
  if (_muted) return;
  try {
    const ctx = getAudioCtx();
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch (e) {}
}

// ── Muscle at risk ────────────────────────────────────────────────────────────
function getMuscleRisk(neck, shoulder, spine, headRoll) {
  if (headRoll > 20)
    return "Trapezius strain risk — head roll sustained too long";
  if (headRoll > 10) return "Levator scapulae under stress from head tilt";
  if (neck > 30) return "Cervical disc pressure — chin too far forward";
  if (neck > 15) return "Upper trapezius tension building up";
  if (spine > 20) return "Lumbar disc compression — sit up now";
  if (spine > 10) return "Erector spinae fatigue — lower back at risk";
  if (shoulder > 20) return "Rotator cuff imbalance — uneven shoulder load";
  if (shoulder > 10) return "Rhomboid strain from shoulder asymmetry";
  return "";
}

// ── Exercise tip ──────────────────────────────────────────────────────────────
function getExerciseTip(neck, shoulder, spine, headRoll) {
  if (headRoll > 10)
    return "30s: Tilt head to opposite side, hold 15s. Switch sides.";
  if (neck > 15)
    return "30s: Chin tucks — pull chin straight back, hold 3s. Repeat 10x.";
  if (spine > 10)
    return "30s: Sit at chair edge, arch lower back gently, hold 10s.";
  if (shoulder > 10)
    return "30s: Roll both shoulders back 5x, hold last rep 10s.";
  return "";
}

// ── FIXED SCORING ─────────────────────────────────────────────────────────────
// Old problem: head roll 45° was barely penalising score
// Fix: penalties are now proportional to angle, not just threshold steps
// Max penalties add up correctly so 45° head roll = score ~55 not ~94

function computeComposite(neck, shoulder, spine, headRoll) {
  let score = 100;

  // Neck forward tilt (max -25)
  if (neck > 30) score -= 25;
  else if (neck > 20) score -= 15;
  else if (neck > 15) score -= 8;

  // Shoulder misalignment (max -25)
  if (shoulder > 20) score -= 25;
  else if (shoulder > 15) score -= 15;
  else if (shoulder > 10) score -= 8;

  // Spine slouch (max -35)
  if (spine > 20) score -= 35;
  else if (spine > 15) score -= 20;
  else if (spine > 10) score -= 10;

  // Head roll — NOW correctly weighted (max -35)
  // At 45° this was only penalising ~12 before. Now properly scaled.
  if (headRoll > 35) score -= 35;
  else if (headRoll > 25) score -= 28;
  else if (headRoll > 15) score -= 18;
  else if (headRoll > 10) score -= 10;

  return Math.max(0, score);
}

function computeStatus(neck, shoulder, spine, headRoll) {
  const issues = [];
  if (headRoll > 25) issues.push("Head tilted severely — level it out now");
  else if (headRoll > 15) issues.push("Head tilted — level it out");
  else if (headRoll > 10) issues.push("Slight head tilt detected");
  if (spine > 20) issues.push("Spine slouch detected");
  if (neck > 30) issues.push("Forward head / chin jutting");
  else if (neck > 15) issues.push("Slight neck tilt");
  if (shoulder > 20) issues.push("Shoulder misalignment");
  else if (shoulder > 10) issues.push("Minor shoulder imbalance");
  return issues.length === 0 ? "Good posture" : issues[0];
}

window.initScore = function () {
  if (_elapsedTimer) return;
  _elapsedTimer = setInterval(() => {
    _elapsed++;
  }, 1000);

  setInterval(() => {
    const cv = window.postureCV;
    if (!cv) return;

    const hasDetection =
      cv.status !== "no_detection" &&
      (cv.neckAngle > 0 ||
        cv.shoulderAngle > 0 ||
        cv.spineAngle > 0 ||
        cv.headRoll > 0);

    if (!hasDetection) {
      _badStreak = 0;
      _prevBad = false;
      window.dispatchEvent(
        new CustomEvent("posture-tick", {
          detail: {
            composite: 0,
            neck: 0,
            shoulder: 0,
            spine: 0,
            headRoll: 0,
            status: "NO_POSE",
            color: "green",
            muscleRisk: "",
            exerciseTip: "",
            earlyWarning: false,
            badStreak: 0,
            justFixed: false,
            neckTilt: 0,
            shoulderAlign: 0,
            spineTilt: 0,
            headRollVal: 0,
            detected: false,
            elapsed: _elapsed,
            scoreHistory: [..._scoreHistory],
            forwardHeadDepth: 0,
            lumbarScore: 100,
            goodSecs: _goodSecs,
            fairSecs: _fairSecs,
            badSecs: _badSecs,
          },
        }),
      );
      return;
    }

    const neck = cv.neckAngle;
    const shoulder = cv.shoulderAngle;
    const spine = cv.spineAngle;
    const headRoll = cv.headRoll || 0;

    let composite = computeComposite(neck, shoulder, spine, headRoll);

    // Side camera blend
    if (window._sideLandmarks && window._sideConnected) {
      const sl = window._sideLandmarks;
      const ear = sl[7],
        sh = sl[11],
        hip = sl[23];
      if (ear && sh && hip) {
        const fwdHead = Math.round(Math.abs(ear.x - sh.x) * 100);
        const lumbarOffset = sh.x - hip.x;
        const lumbarScore = Math.max(
          0,
          Math.round(lumbarOffset > 0.05 ? 100 : 100 + lumbarOffset * 200),
        );
        const sideScore = Math.round(
          (100 - Math.min(fwdHead * 2, 50)) * 0.5 + lumbarScore * 0.5,
        );
        composite = Math.round(composite * 0.8 + sideScore * 0.2);
        window.postureScore.forwardHeadDepth = fwdHead;
        window.postureScore.lumbarScore = lumbarScore;
      }
    }

    // Track posture time
    if (composite >= 80) _goodSecs++;
    else if (composite >= 50) _fairSecs++;
    else _badSecs++;

    const isBad = composite < 80;

    // Early warning at 90s
    if (isBad) _badStreak++;
    else _badStreak = 0;

    const earlyWarning =
      _badStreak === 90 || (_badStreak > 90 && _badStreak % 180 === 0);

    // "Fixed it" — was bad last tick, now good
    const justFixed = _prevBad && !isBad;
    if (justFixed) playFixed();

    // Nudge sound at alert threshold
    const alertThreshold = 480; // relaxed mode default
    if (_badStreak === alertThreshold) playNudge();

    _prevBad = isBad;

    const status = computeStatus(neck, shoulder, spine, headRoll);
    const muscleRisk = getMuscleRisk(neck, shoulder, spine, headRoll);
    const exerciseTip = getExerciseTip(neck, shoulder, spine, headRoll);

    // Color bands
    let color = "green";
    if (composite < 50) color = "red";
    else if (composite < 80) color = "yellow";

    window.postureScore.composite = composite;
    window.postureScore.neck = neck;
    window.postureScore.shoulder = shoulder;
    window.postureScore.spine = spine;
    window.postureScore.headRoll = headRoll;
    window.postureScore.status = status;
    window.postureScore.color = color;
    window.postureScore.muscleRisk = muscleRisk;
    window.postureScore.exerciseTip = exerciseTip;
    window.postureScore.earlyWarning = earlyWarning;
    window.postureScore.badStreak = _badStreak;
    window.postureScore.goodSecs = _goodSecs;
    window.postureScore.fairSecs = _fairSecs;
    window.postureScore.badSecs = _badSecs;

    _scoreHistory.push(composite);
    if (_scoreHistory.length > 18) _scoreHistory.shift();

    window.dispatchEvent(
      new CustomEvent("posture-tick", {
        detail: {
          ...window.postureScore,
          elapsed: _elapsed,
          scoreHistory: [..._scoreHistory],
          neckTilt: neck,
          shoulderAlign: shoulder,
          spineTilt: spine,
          headRollVal: headRoll,
          detected: true,
          justFixed,
          earlyWarning,
          badStreak: _badStreak,
          goodSecs: _goodSecs,
          fairSecs: _fairSecs,
          badSecs: _badSecs,
          forwardHeadDepth: window.postureScore.forwardHeadDepth || 0,
          lumbarScore: window.postureScore.lumbarScore || 100,
        },
      }),
    );
  }, 1000);
};
