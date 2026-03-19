// ============================================================
// PostureAI — CV Pipeline v2
// Front camera only — no side view, no phone needed
//
// 4 metrics detected from a single front webcam:
//   1. Neck forward tilt  — ear X offset + Z depth
//   2. Shoulder alignment — horizontal level of both shoulders
//   3. Spine tilt         — hip to shoulder vertical angle
//   4. Head roll          — ear-to-ear angle minus shoulder roll baseline
// ============================================================

const IDX = {
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  NOSE: 0,
};

const scoreBuffer = [];
const BUFFER_SIZE = 10;

function smoothedScore(raw) {
  scoreBuffer.push(raw);
  if (scoreBuffer.length > BUFFER_SIZE) scoreBuffer.shift();
  return Math.round(
    scoreBuffer.reduce((a, b) => a + b, 0) / scoreBuffer.length,
  );
}

function angleFromVertical(pointA, pointB) {
  const dx = pointB.x - pointA.x,
    dy = pointB.y - pointA.y;
  return Math.round(
    Math.abs(90 - Math.abs(Math.atan2(dy, dx) * (180 / Math.PI))),
  );
}

function angleFromHorizontal(pointA, pointB) {
  const dx = pointB.x - pointA.x,
    dy = pointB.y - pointA.y;
  let angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  if (angle > 90) angle = 180 - angle;
  return Math.round(angle);
}

function calculateAngles(landmarks) {
  const lEarRaw = landmarks[IDX.LEFT_EAR];
  const rEarRaw = landmarks[IDX.RIGHT_EAR];
  const lSho = landmarks[IDX.LEFT_SHOULDER];
  const rSho = landmarks[IDX.RIGHT_SHOULDER];
  const lHip = landmarks[IDX.LEFT_HIP];
  const rHip = landmarks[IDX.RIGHT_HIP];
  const nose = landmarks[IDX.NOSE];

  const shoulderMidY = (lSho.y + rSho.y) / 2;
  const faceHeight = Math.abs(nose.y - shoulderMidY);
  const earYOffset = faceHeight * 0.12;
  const lEar = { ...lEarRaw, y: lEarRaw.y - earYOffset };
  const rEar = { ...rEarRaw, y: rEarRaw.y - earYOffset };

  // Head roll
  const earRollRaw = angleFromHorizontal(lEar, rEar);
  const shoulderRollRaw = angleFromHorizontal(lSho, rSho);
  const headRoll = Math.max(0, earRollRaw - shoulderRollRaw);

  // Neck forward tilt
  const shoulderWidth = Math.abs(lSho.x - rSho.x);
  const earWidth = Math.abs(lEar.x - rEar.x);
  const xRatio = shoulderWidth > 0.05 ? earWidth / shoulderWidth : 1;
  const xAngle = Math.round(Math.max(0, (1 - xRatio) * 30));
  const avgEarZ = (lEar.z + rEar.z) / 2;
  const avgShoZ = (lSho.z + rSho.z) / 2;
  const zAngle = Math.round(Math.min(15, Math.max(0, avgShoZ - avgEarZ) * 80));
  let neckAngle = Math.min(40, Math.round(xAngle * 0.4 + zAngle * 0.6));

  // Camera angle compensation
  const earMidY = (lEar.y + rEar.y) / 2;
  if (nose.y - earMidY > 0.02) {
    neckAngle = Math.max(0, neckAngle - Math.round((nose.y - earMidY) * 40));
  }

  const shoulderAngle = shoulderRollRaw;

  const hipRef =
    lHip && rHip && lHip.visibility > 0.3 && rHip.visibility > 0.3
      ? { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 }
      : lHip && lHip.visibility > 0.2
        ? lHip
        : null;

  let spineAngle = 0;
  if (hipRef) {
    spineAngle = angleFromVertical(hipRef, {
      x: (lSho.x + rSho.x) / 2,
      y: shoulderMidY,
    });
    const faceSize = Math.abs(lEar.y - lSho.y);
    if (faceSize < 0.25)
      spineAngle = Math.round(spineAngle * (faceSize / 0.25));
  }

  return { neckAngle, shoulderAngle, spineAngle, headRoll };
}

function syncCanvasSize() {
  const video = document.getElementById("webcam"),
    canvas = document.getElementById("overlay");
  if (!video || !canvas) return;
  const rect = video.getBoundingClientRect();
  if (rect.width > 0) {
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
  }
}

function drawPlacementGuide(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  const cx = width / 2;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.stroke();
  const sy = height * 0.3;
  ctx.beginPath();
  ctx.moveTo(width * 0.15, sy);
  ctx.lineTo(width * 0.85, sy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawLostMessage(ctx, canvas) {
  ctx.save();
  ctx.strokeStyle = "rgba(239,68,68,0.5)";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.setLineDash([]);
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(canvas.width / 2 - 190, canvas.height / 2 - 30, 380, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "Can't see you — sit back, face camera",
    canvas.width / 2,
    canvas.height / 2 + 5,
  );
  ctx.restore();
}

function drawSkeleton(ctx, canvas, landmarks, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width,
    H = canvas.height;
  function px(lm) {
    return { x: lm.x * W, y: lm.y * H };
  }

  const lEar = px(landmarks[IDX.LEFT_EAR]);
  const rEar = px(landmarks[IDX.RIGHT_EAR]);
  const lSho = px(landmarks[IDX.LEFT_SHOULDER]);
  const rSho = px(landmarks[IDX.RIGHT_SHOULDER]);
  const lHip = px(landmarks[IDX.LEFT_HIP]);
  const rHip = px(landmarks[IDX.RIGHT_HIP]);

  const sc =
    color === "red" ? "#ef4444" : color === "amber" ? "#f59e0b" : "#10b981";

  const lHipVis = landmarks[IDX.LEFT_HIP].visibility > 0.2;
  const rHipVis = landmarks[IDX.RIGHT_HIP].visibility > 0.2;
  const lEarVis = landmarks[IDX.LEFT_EAR].visibility > 0.2;
  const rEarVis = landmarks[IDX.RIGHT_EAR].visibility > 0.2;

  const bones = [
    ...(lEarVis ? [[lEar, lSho]] : []),
    ...(rEarVis ? [[rEar, rSho]] : []),
    [lSho, rSho],
    ...(lHipVis ? [[lSho, lHip]] : []),
    ...(rHipVis ? [[rSho, rHip]] : []),
    ...(lHipVis && rHipVis ? [[lHip, rHip]] : []),
  ];

  ctx.strokeStyle = sc;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  bones.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.9;
  [
    ...(lEarVis ? [lEar] : []),
    ...(rEarVis ? [rEar] : []),
    lSho,
    rSho,
    ...(lHipVis ? [lHip] : []),
    ...(rHipVis ? [rHip] : []),
  ].forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
    ctx.fill();
  });

  // Forward head indicator — subtle
  const midEarX = (lEar.x + rEar.x) / 2,
    midEarY = (lEar.y + rEar.y) / 2;
  const midShoX = (lSho.x + rSho.x) / 2,
    midShoY = (lSho.y + rSho.y) / 2;
  ctx.save();
  ctx.strokeStyle = "rgba(168,85,247,0.4)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(midShoX, midShoY);
  ctx.lineTo(midShoX, midEarY);
  ctx.stroke();
  if (Math.abs(midEarX - midShoX) > 8) {
    ctx.strokeStyle = sc;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(midShoX, midEarY);
    ctx.lineTo(midEarX, midEarY);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

window.postureCV = {
  neckAngle: 0,
  shoulderAngle: 0,
  spineAngle: 0,
  headRoll: 0,
  status: "good",
};
window._sideLandmarks = null;
window._sideConnected = false;
window.initSideView = () => {};
window.setViewMode = () => {};
window._viewMode = "front";
window._isMobile = /Mobi|Android/i.test(navigator.userAgent);

window.initCV = function () {
  const video = document.getElementById("webcam"),
    canvas = document.getElementById("overlay");
  if (!video || !canvas) {
    console.warn("[PostureAI] webcam or overlay not found");
    return;
  }

  const ctx = canvas.getContext("2d");
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";

  syncCanvasSize();
  setTimeout(syncCanvasSize, 300);
  setTimeout(syncCanvasSize, 1000);
  window.addEventListener("resize", syncCanvasSize);

  video.style.transform = "scaleX(-1)";
  canvas.style.transform = "scaleX(-1)";

  // ── Zoom out: object-fit contains instead of cover ────────────────────────
  // We set this via JS so it applies after the element is ready
  video.style.objectFit = "contain";
  video.style.background = "#0d0d0d";

  const pose = new Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  pose.onResults((results) => {
    syncCanvasSize();
    if (!results.poseLandmarks) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPlacementGuide(ctx, canvas.width, canvas.height);
      window.postureCV.neckAngle = 0;
      window.postureCV.shoulderAngle = 0;
      window.postureCV.spineAngle = 0;
      window.postureCV.headRoll = 0;
      window.postureCV.status = "no_detection";
      window.dispatchEvent(new CustomEvent("posture-lost"));
      return;
    }

    const lm = results.poseLandmarks;
    const lSho = lm[IDX.LEFT_SHOULDER],
      rSho = lm[IDX.RIGHT_SHOULDER];
    const lEar = lm[IDX.LEFT_EAR],
      rEar = lm[IDX.RIGHT_EAR],
      nose = lm[IDX.NOSE];

    const shouldersVisible =
      lSho && lSho.visibility > 0.3 && rSho && rSho.visibility > 0.3;
    const atLeastOneEar =
      (lEar && lEar.visibility > 0.2) || (rEar && rEar.visibility > 0.2);
    const noseVisible = nose && nose.visibility > 0.3;
    const plausibleWidth = Math.abs(lSho.x - rSho.x) > 0.04;

    if (
      !shouldersVisible ||
      !atLeastOneEar ||
      !noseVisible ||
      !plausibleWidth
    ) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLostMessage(ctx, canvas);
      drawPlacementGuide(ctx, canvas.width, canvas.height);
      window.postureCV.status = "no_detection";
      window.dispatchEvent(new CustomEvent("posture-lost"));
      return;
    }

    window.dispatchEvent(new CustomEvent("posture-found"));
    const angles = calculateAngles(lm);
    window.postureCV.neckAngle = angles.neckAngle;
    window.postureCV.shoulderAngle = angles.shoulderAngle;
    window.postureCV.spineAngle = angles.spineAngle;
    window.postureCV.headRoll = angles.headRoll;

    const rawBad =
      (angles.neckAngle > 30 ? 30 : angles.neckAngle > 15 ? 10 : 0) +
      (angles.shoulderAngle > 20 ? 25 : angles.shoulderAngle > 10 ? 8 : 0) +
      (angles.spineAngle > 20 ? 40 : angles.spineAngle > 10 ? 15 : 0) +
      (angles.headRoll > 20 ? 30 : angles.headRoll > 10 ? 12 : 0);

    const badScore = smoothedScore(rawBad);
    const color = badScore >= 60 ? "red" : badScore >= 30 ? "amber" : "green";
    window.postureCV.status =
      badScore >= 60 ? "bad" : badScore >= 30 ? "fair" : "good";

    drawSkeleton(ctx, canvas, lm, color);
    drawPlacementGuide(ctx, canvas.width, canvas.height);
  });

  navigator.mediaDevices
    // ── Request wider FOV — ideal width > height forces landscape/wide mode
    .getUserMedia({
      video: {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        facingMode: "user",
      },
      audio: false,
    })
    .then((stream) => {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        window.dispatchEvent(
          new CustomEvent("posture-camera-status", { detail: "ACTIVE" }),
        );
        const camera = new Camera(video, {
          onFrame: async () => {
            syncCanvasSize();
            await pose.send({ image: video });
          },
          width: 1280,
          height: 720,
        });
        camera.start();
        window.dispatchEvent(
          new CustomEvent("posture-camera-status", { detail: "TRACKING" }),
        );
      };
    })
    .catch((err) => {
      console.error("[PostureAI] Camera error:", err);
      window.dispatchEvent(
        new CustomEvent("posture-camera-status", { detail: "ERROR" }),
      );
    });
};
