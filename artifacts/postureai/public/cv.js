// PostureAI — CV Pipeline
// cv.js — NO mirror flip, dispatches posture-tick CustomEvents

const IDX = {
  LEFT_EAR:       7,
  RIGHT_EAR:      8,
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP:       23,
  RIGHT_HIP:      24,
};

function angleFromVertical(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const angle = Math.abs(90 - Math.abs(Math.atan2(dy, dx) * (180 / Math.PI)));
  return Math.round(angle);
}

function angleFromHorizontal(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  let angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  if (angle > 90) angle = 180 - angle;
  return Math.round(angle);
}

function calculateAngles(landmarks) {
  const leftEar       = landmarks[IDX.LEFT_EAR];
  const leftShoulder  = landmarks[IDX.LEFT_SHOULDER];
  const rightShoulder = landmarks[IDX.RIGHT_SHOULDER];
  const leftHip       = landmarks[IDX.LEFT_HIP];

  const neckAngle     = angleFromVertical(leftShoulder, leftEar);
  const shoulderAngle = angleFromHorizontal(leftShoulder, rightShoulder);
  const spineAngle    = angleFromVertical(leftHip, leftShoulder);

  return { neckAngle, shoulderAngle, spineAngle };
}

function computeScore(neckAngle, shoulderAngle, spineAngle) {
  let score = 100;
  // Neck: ideal <10, moderate 10-20, bad >20
  if (neckAngle > 20) score -= 35;
  else if (neckAngle > 10) score -= 15;
  // Shoulder: ideal <5, moderate 5-10, bad >10
  if (shoulderAngle > 10) score -= 25;
  else if (shoulderAngle > 5) score -= 10;
  // Spine: ideal <5, moderate 5-10, bad >10
  if (spineAngle > 10) score -= 40;
  else if (spineAngle > 5) score -= 20;
  return Math.max(0, score);
}

function computeStatus(neckAngle, shoulderAngle, spineAngle) {
  const issues = [];
  if (spineAngle > 10) issues.push("spine slouch detected");
  if (neckAngle > 20)  issues.push("forward head / chin jutting");
  else if (neckAngle > 10) issues.push("slight neck tilt");
  if (shoulderAngle > 10) issues.push("shoulder misalignment");
  else if (shoulderAngle > 5) issues.push("minor shoulder imbalance");
  if (issues.length === 0) return "Good posture";
  return issues[0].charAt(0).toUpperCase() + issues[0].slice(1);
}

function drawSkeleton(ctx, canvas, landmarks, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width;
  const H = canvas.height;

  function px(lm) {
    return { x: lm.x * W, y: lm.y * H };
  }

  const lEar = px(landmarks[IDX.LEFT_EAR]);
  const rEar = px(landmarks[IDX.RIGHT_EAR]);
  const lSho = px(landmarks[IDX.LEFT_SHOULDER]);
  const rSho = px(landmarks[IDX.RIGHT_SHOULDER]);
  const lHip = px(landmarks[IDX.LEFT_HIP]);
  const rHip = px(landmarks[IDX.RIGHT_HIP]);

  const bones = [
    [lEar, lSho],
    [rEar, rSho],
    [lSho, rSho],
    [lSho, lHip],
    [rSho, rHip],
    [lHip, rHip],
  ];

  const strokeColor = color === "red" ? "#ef4444" : color === "amber" ? "#f59e0b" : "#10b981";
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;

  bones.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  const dots = [lEar, rEar, lSho, rSho, lHip, rHip];
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  dots.forEach(point => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  });
}

// Dispatch tick to React app
function dispatchTick(data) {
  window.dispatchEvent(new CustomEvent("posture-tick", { detail: data }));
}

// Init — called by Dashboard after video/canvas are ready
window.initPostureCV = function(videoEl, canvasEl) {
  const ctx = canvasEl.getContext('2d');

  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  pose.setOptions({
    modelComplexity:        1,
    smoothLandmarks:        true,
    enableSegmentation:     false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence:  0.5,
  });

  pose.onResults((results) => {
    if (!results.poseLandmarks) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      dispatchTick({
        detected: false,
        composite: 0,
        color: "green",
        status: "NO_POSE",
        neckTilt: 0,
        shoulderAlign: 0,
        spineTilt: 0,
      });
      return;
    }

    const landmarks = results.poseLandmarks;
    const { neckAngle, shoulderAngle, spineAngle } = calculateAngles(landmarks);
    const composite = computeScore(neckAngle, shoulderAngle, spineAngle);
    const status = computeStatus(neckAngle, shoulderAngle, spineAngle);

    let color = "green";
    if (composite < 40) color = "red";
    else if (composite < 70) color = "amber";

    drawSkeleton(ctx, canvasEl, landmarks, color);

    dispatchTick({
      detected: true,
      composite,
      color,
      status,
      neckTilt: neckAngle,
      shoulderAlign: shoulderAngle,
      spineTilt: spineAngle,
    });
  });

  const camera = new Camera(videoEl, {
    onFrame: async () => {
      await pose.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });

  camera.start();

  return camera;
};
