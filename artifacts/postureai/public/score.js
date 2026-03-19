// PostureAI — Score Pipeline
// score.js — Reads window.postureCV, computes scores, dispatches posture-tick

window.postureScore = {
  composite: 0,
  neck: 0,
  shoulder: 0,
  spine: 0,
  status: 'NO_POSE',
  color: 'green',
  forwardHeadDepth: 0,
  lumbarScore: 100,
};

let _scoreHistory = [];
let _elapsed = 0;
let _elapsedTimer = null;

function computeComposite(neck, shoulder, spine) {
  let score = 100;
  if (neck > 20) score -= 35; else if (neck > 10) score -= 15;
  if (shoulder > 10) score -= 25; else if (shoulder > 5) score -= 10;
  if (spine > 10) score -= 40; else if (spine > 5) score -= 20;
  return Math.max(0, score);
}

function computeStatus(neck, shoulder, spine) {
  const issues = [];
  if (spine > 10) issues.push('Spine slouch detected');
  if (neck > 20) issues.push('Forward head / chin jutting');
  else if (neck > 10) issues.push('Slight neck tilt');
  if (shoulder > 10) issues.push('Shoulder misalignment');
  else if (shoulder > 5) issues.push('Minor shoulder imbalance');
  return issues.length === 0 ? 'Good posture' : issues[0];
}

window.initScore = function() {
  if (_elapsedTimer) return;

  // Elapsed time counter
  _elapsedTimer = setInterval(() => { _elapsed++; }, 1000);

  // Posture evaluation loop at ~1Hz
  setInterval(() => {
    const cv = window.postureCV;
    if (!cv) return;
    const hasDetection = cv.neckAngle > 0 || cv.shoulderAngle > 0 || cv.spineAngle > 0;
    if (!hasDetection) {
      window.dispatchEvent(new CustomEvent('posture-tick', {
        detail: {
          composite: 0, neck: 0, shoulder: 0, spine: 0,
          status: 'NO_POSE', color: 'green',
          neckTilt: 0, shoulderAlign: 0, spineTilt: 0,
          detected: false, elapsed: _elapsed, scoreHistory: [..._scoreHistory],
          forwardHeadDepth: 0, lumbarScore: 100,
        }
      }));
      return;
    }

    const neck     = cv.neckAngle;
    const shoulder = cv.shoulderAngle;
    const spine    = cv.spineAngle;

    let composite = computeComposite(neck, shoulder, spine);

    // Blend with side camera data if available
    if (window._sideLandmarks && window._sideConnected) {
      const sl = window._sideLandmarks;
      const ear = sl[7], sh = sl[11], hip = sl[23];
      if (ear && sh && hip) {
        const fwdHead = Math.round(Math.abs(ear.x - sh.x) * 100);
        const lumbarOffset = sh.x - hip.x;
        const lumbarScore = Math.max(0, Math.round(lumbarOffset > 0.05 ? 100 : 100 + lumbarOffset * 200));
        const sideScore = Math.round((100 - Math.min(fwdHead * 2, 50)) * 0.5 + lumbarScore * 0.5);
        const blended = Math.round(composite * 0.8 + sideScore * 0.2);
        window.postureScore.forwardHeadDepth = fwdHead;
        window.postureScore.lumbarScore = lumbarScore;
        window.postureScore.composite = blended;
        composite = blended;
      }
    }

    const status = computeStatus(neck, shoulder, spine);
    let color = 'green';
    if (composite < 40) color = 'red';
    else if (composite < 70) color = 'yellow';

    window.postureScore.composite = composite;
    window.postureScore.neck = neck;
    window.postureScore.shoulder = shoulder;
    window.postureScore.spine = spine;
    window.postureScore.status = status;
    window.postureScore.color = color;

    _scoreHistory.push(composite);
    if (_scoreHistory.length > 18) _scoreHistory.shift();

    const elapsed = _elapsed;

    window.dispatchEvent(new CustomEvent('posture-tick', {
      detail: {
        ...window.postureScore,
        elapsed,
        scoreHistory: [..._scoreHistory],
        neckTilt: cv.neckAngle || 0,
        shoulderAlign: cv.shoulderAngle || 0,
        spineTilt: cv.spineAngle || 0,
        detected: true,
        forwardHeadDepth: window.postureScore.forwardHeadDepth || 0,
        lumbarScore: window.postureScore.lumbarScore || 100,
      }
    }));
  }, 1000);
};
