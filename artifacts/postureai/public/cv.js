// PostureAI — CV Pipeline
// cv.js — No mirror, dispatches posture-camera-status events, populates window.postureCV

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
  return Math.round(Math.abs(90 - Math.abs(Math.atan2(dy, dx) * (180 / Math.PI))));
}

function angleFromHorizontal(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  let angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  if (angle > 90) angle = 180 - angle;
  return Math.round(angle);
}

function _applyMirror(video, canvas, isRear) {
  video.style.transform = 'none';
  canvas.style.transform = 'none';
}

function syncCanvasSize() {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('overlay');
  if (!video || !canvas) return;
  const rect = video.getBoundingClientRect();
  if (rect.width > 0) {
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
  }
}

function drawPlacementGuide(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  const cx = width / 2;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.stroke();
  const shoulderY = height * 0.35;
  ctx.beginPath();
  ctx.moveTo(width * 0.2, shoulderY);
  ctx.lineTo(width * 0.8, shoulderY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSkeleton(ctx, canvas, landmarks, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width;
  const H = canvas.height;

  function px(lm) { return { x: lm.x * W, y: lm.y * H }; }

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

  const strokeColor = color === 'red' ? '#ef4444' : color === 'amber' ? '#f59e0b' : '#10b981';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;

  bones.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  [lEar, rEar, lSho, rSho, lHip, rHip].forEach(pt => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
    ctx.fill();
  });
}

window.postureCV = {
  neckAngle: 0,
  shoulderAngle: 0,
  spineAngle: 0,
};

window._sideLandmarks = null;
window._sideConnected = false;

window.initSideView = () => {
  try {
    const ws = new WebSocket(`ws://${window.location.host}/signal`);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.onopen = () => {
        window._sideConnected = true;
        window.dispatchEvent(new CustomEvent('posture-side-connected'));
      };
      dc.onclose = () => { window._sideConnected = false; window._sideLandmarks = null; };
      dc.onmessage = (msg) => {
        try {
          const d = JSON.parse(msg.data);
          if (d.type === 'side-landmarks') window._sideLandmarks = d.landmarks;
        } catch (_) {}
      };
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: 'candidate', candidate: e.candidate, from: 'laptop' }));
    };
    ws.onmessage = async (msg) => {
      const d = JSON.parse(msg.data);
      if (d.from === 'laptop') return;
      if (d.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        ws.send(JSON.stringify({ type: 'answer', sdp: ans, from: 'laptop' }));
      } else if (d.type === 'candidate' && d.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
      }
    };
    ws.onerror = () => {};
  } catch (e) {
    console.warn('[PostureAI] Side view init failed:', e);
  }
};

window.setViewMode = (mode) => {
  window._viewMode = mode;
};
window._viewMode = 'front';
window._isMobile = /Mobi|Android/i.test(navigator.userAgent);

window.initCV = function() {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('overlay');
  if (!video || !canvas) {
    console.warn('[PostureAI] webcam or overlay element not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  syncCanvasSize();
  setTimeout(syncCanvasSize, 300);
  setTimeout(syncCanvasSize, 1000);

  window.addEventListener('resize', syncCanvasSize);

  _applyMirror(video, canvas, false);

  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
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
      return;
    }

    const lm = results.poseLandmarks;
    const lEar  = lm[IDX.LEFT_EAR];
    const lSho  = lm[IDX.LEFT_SHOULDER];
    const rSho  = lm[IDX.RIGHT_SHOULDER];
    const lHip  = lm[IDX.LEFT_HIP];

    const neckAngle     = angleFromVertical(lSho, lEar);
    const shoulderAngle = angleFromHorizontal(lSho, rSho);
    const spineAngle    = angleFromVertical(lHip, lSho);

    window.postureCV.neckAngle     = neckAngle;
    window.postureCV.shoulderAngle = shoulderAngle;
    window.postureCV.spineAngle    = spineAngle;

    let color = 'green';
    const badScore = (neckAngle > 20 ? 35 : neckAngle > 10 ? 15 : 0)
                   + (shoulderAngle > 10 ? 25 : shoulderAngle > 5 ? 10 : 0)
                   + (spineAngle > 10 ? 40 : spineAngle > 5 ? 20 : 0);
    if (badScore >= 60) color = 'red';
    else if (badScore >= 30) color = 'amber';

    drawSkeleton(ctx, canvas, lm, color);
    drawPlacementGuide(ctx, canvas.width, canvas.height);
  });

  navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  }).then(stream => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      window.dispatchEvent(new CustomEvent('posture-camera-status', { detail: 'ACTIVE' }));
      const camera = new Camera(video, {
        onFrame: async () => {
          syncCanvasSize();
          await pose.send({ image: video });
        },
        width: 640,
        height: 480,
      });
      camera.start();
      window.dispatchEvent(new CustomEvent('posture-camera-status', { detail: 'TRACKING' }));
    };
  }).catch(err => {
    console.error('[PostureAI] Camera error:', err);
    window.dispatchEvent(new CustomEvent('posture-camera-status', { detail: 'ERROR' }));
  });

  window.initSideView();
};
