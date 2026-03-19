// ============================================================
// PostureAI — CV Pipeline
// cv.js
//
// What this file does, in order:
//   1. Grabs the webcam feed
//   2. Feeds each frame into MediaPipe Pose
//   3. Extracts the 6 landmarks we care about
//   4. Draws dots + bone lines on the canvas
//   5. Calculates 3 posture angles
//   6. Displays them on screen
//   7. Exports the angles so teammates can use them
// ============================================================


// ------ 1. GRAB DOM ELEMENTS --------------------------------

const video   = document.getElementById('webcam');
const canvas  = document.getElementById('overlay');
const ctx     = canvas.getContext('2d');
const status  = document.getElementById('status');

const neckDisplay     = document.getElementById('neck-val');
const shoulderDisplay = document.getElementById('shoulder-val');
const spineDisplay    = document.getElementById('spine-val');


// ------ 2. LANDMARK INDICES (MediaPipe Pose) ----------------
// These are the only 6 out of 33 landmarks we need.

const IDX = {
  LEFT_EAR:       7,
  RIGHT_EAR:      8,
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP:       23,
  RIGHT_HIP:      24,
};


// ------ 3. ANGLE MATH ---------------------------------------
// Takes two points and returns the angle of the line
// between them relative to vertical (in degrees).
// Used for neck tilt and spine tilt.

function angleFromVertical(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  // atan2 gives angle from horizontal, so we subtract from 90
  const angle = Math.abs(90 - Math.abs(Math.atan2(dy, dx) * (180 / Math.PI)));
  return Math.round(angle);
}

// Takes two points, returns the angle of the line
// between them relative to horizontal (in degrees).
// Used for shoulder alignment.

function angleFromHorizontal(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  let angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  // Always return the small angle (never more than 90°)
  if (angle > 90) angle = 180 - angle;
  return Math.round(angle);
}


// ------ 4. CALCULATE POSTURE ANGLES -------------------------
// Takes the full landmarks array, returns the 3 angles.
// This is the core of your CV pipeline.

function calculateAngles(landmarks) {

  const leftEar       = landmarks[IDX.LEFT_EAR];
  const leftShoulder  = landmarks[IDX.LEFT_SHOULDER];
  const rightShoulder = landmarks[IDX.RIGHT_SHOULDER];
  const leftHip       = landmarks[IDX.LEFT_HIP];

  // Neck tilt: how far forward is the ear relative to the shoulder?
  // Ideal = close to 0°. Bad posture = higher number.
  const neckAngle = angleFromVertical(leftShoulder, leftEar);

  // Shoulder alignment: are both shoulders level?
  // Ideal = close to 0°. One shoulder higher = higher number.
  const shoulderAngle = angleFromHorizontal(leftShoulder, rightShoulder);

  // Spine tilt: how far is the shoulder leaning from the hip?
  // Ideal = close to 0°. Slouching = higher number.
  const spineAngle = angleFromVertical(leftHip, leftShoulder);

  return { neckAngle, shoulderAngle, spineAngle };
}


// ------ 5. DRAW SKELETON ON CANVAS --------------------------
// Draws dots on the 6 landmarks and lines connecting them.

function drawSkeleton(landmarks) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W = canvas.width;
  const H = canvas.height;

  // Helper: convert normalised (0-1) coords to canvas pixels
  function px(lm) {
    return { x: lm.x * W, y: lm.y * H };
  }

  const lEar  = px(landmarks[IDX.LEFT_EAR]);
  const rEar  = px(landmarks[IDX.RIGHT_EAR]);
  const lSho  = px(landmarks[IDX.LEFT_SHOULDER]);
  const rSho  = px(landmarks[IDX.RIGHT_SHOULDER]);
  const lHip  = px(landmarks[IDX.LEFT_HIP]);
  const rHip  = px(landmarks[IDX.RIGHT_HIP]);

  // Draw bone lines first (so dots appear on top)
  const bones = [
    [lEar, lSho],   // left ear to left shoulder
    [rEar, rSho],   // right ear to right shoulder
    [lSho, rSho],   // shoulder to shoulder
    [lSho, lHip],   // left shoulder to left hip
    [rSho, rHip],   // right shoulder to right hip
    [lHip, rHip],   // hip to hip
  ];

  ctx.strokeStyle = '#c8f060';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;

  bones.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  // Draw landmark dots
  const dots = [lEar, rEar, lSho, rSho, lHip, rHip];

  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;

  dots.forEach(point => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  });
}


// ------ 6. UPDATE THE ANGLE DISPLAY -------------------------

function updateDisplay(angles) {
  neckDisplay.innerHTML     = angles.neckAngle     + '<span class="unit">°</span>';
  shoulderDisplay.innerHTML = angles.shoulderAngle + '<span class="unit">°</span>';
  spineDisplay.innerHTML    = angles.spineAngle    + '<span class="unit">°</span>';
}


// ------ 7. THE OUTPUT OBJECT --------------------------------
// This is what your teammates import.
// It updates every frame automatically.

window.postureCV = {
  neckAngle:     0,
  shoulderAngle: 0,
  spineAngle:    0,
};


// ------ 8. MEDIAPIPE SETUP ----------------------------------

const pose = new Pose({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
  }
});

pose.setOptions({
  modelComplexity:        1,    // 0 = fast, 1 = balanced, 2 = accurate
  smoothLandmarks:        true, // reduces jitter between frames
  enableSegmentation:     false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence:  0.5,
});

// This runs every time MediaPipe finishes processing a frame
pose.onResults((results) => {

  if (!results.poseLandmarks) {
    // No person detected in frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const landmarks = results.poseLandmarks;

  // Draw the skeleton
  drawSkeleton(landmarks);

  // Calculate angles
  const angles = calculateAngles(landmarks);

  // Update the on-screen display
  updateDisplay(angles);

  // Update the shared output object (for teammates)
  window.postureCV.neckAngle     = angles.neckAngle;
  window.postureCV.shoulderAngle = angles.shoulderAngle;
  window.postureCV.spineAngle    = angles.spineAngle;

  // Also log to console so you can calibrate thresholds
  // Comment this out once you're happy with the numbers
  console.log('Angles:', angles);
});


// ------ 9. START THE WEBCAM ---------------------------------

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });

    video.srcObject = stream;

    // Once the video is ready, start the MediaPipe camera loop
    video.onloadedmetadata = () => {
      const camera = new Camera(video, {
        onFrame: async () => {
          await pose.send({ image: video });
        },
        width: 640,
        height: 480,
      });

      camera.start();
      status.textContent = 'Camera running — stand in frame';
      status.className = 'ok';
    };

  } catch (err) {
    status.textContent = 'Camera error: ' + err.message;
    status.className = 'error';
    console.error('Camera error:', err);
  }
}

// Kick everything off
startCamera();