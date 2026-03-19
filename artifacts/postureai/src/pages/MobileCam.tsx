import { useEffect, useRef, useState } from "react";

export default function MobileCam() {
  const vRef = useRef<HTMLVideoElement>(null);
  const cRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Starting rear camera...");
  const [conn, setConn] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Safe camera getter — 4 fallback methods ──────────────────────────────
  async function safeGetCamera(): Promise<MediaStream> {
    const methods = [
      // Method 1: exact environment (rear camera)
      () =>
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        }),
      // Method 2: environment without exact
      () =>
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        }),
      // Method 3: enumerate devices — pick last camera (usually rear)
      async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const rear = cams[cams.length - 1];
        if (!rear) throw new Error("No camera found");
        return navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: rear.deviceId } },
          audio: false,
        });
      },
      // Method 4: last resort — any camera
      () => navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
    ];

    for (const method of methods) {
      try {
        return await method();
      } catch (e) {
        // try next
      }
    }
    throw new Error("All camera methods failed");
  }

  // ── Stop any existing stream ──────────────────────────────────────────────
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        t.stop();
        t.enabled = false;
      });
      streamRef.current = null;
    }
    if (vRef.current) {
      vRef.current.srcObject = null;
      vRef.current.src = "";
      vRef.current.load();
    }
  }

  useEffect(() => {
    // ── WebRTC signalling ─────────────────────────────────────────────────
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/signal`);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const dc = pc.createDataChannel("landmarks");
    dcRef.current = dc;

    dc.onopen = () => {
      setConn(true);
      setStatus("Connected to laptop!");
    };
    dc.onclose = () => {
      setConn(false);
      setStatus("Disconnected — refresh to retry");
    };

    pc.onicecandidate = (e) => {
      if (e.candidate)
        ws.send(
          JSON.stringify({
            type: "candidate",
            candidate: e.candidate,
            from: "mobile",
          }),
        );
    };

    ws.onopen = async () => {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      ws.send(JSON.stringify({ type: "offer", sdp: o, from: "mobile" }));
    };

    ws.onmessage = async (msg) => {
      try {
        const text =
          typeof msg.data === "string" ? msg.data : await msg.data.text();
        const d = JSON.parse(text);
        if (d.from === "mobile") return;
        if (d.type === "answer")
          await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        else if (d.type === "candidate" && d.candidate)
          await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
      } catch (e) {
        console.warn("ws message error", e);
      }
    };
    ws.onerror = () => {};

    // ── Start camera ──────────────────────────────────────────────────────
    const startCamera = async () => {
      setStatus("Starting rear camera...");

      // Always stop any existing stream first
      stopStream();

      // Wait for Android hardware to fully release
      await new Promise((r) => setTimeout(r, 1500));

      try {
        const stream = await safeGetCamera();

        if (!vRef.current) return;

        streamRef.current = stream;
        vRef.current.srcObject = stream;

        // Wait for video metadata to load before starting pose
        await new Promise<void>((resolve, reject) => {
          if (!vRef.current) return reject();
          vRef.current.onloadedmetadata = () => resolve();
          vRef.current.onerror = () => reject(new Error("Video load error"));
          // Timeout fallback
          setTimeout(resolve, 3000);
        });

        await vRef.current.play().catch(() => {});
        setStatus("Camera ready — positioning...");
        startPose();
      } catch (err) {
        console.error("Camera failed:", err);
        setStatus("Could not access camera — check permissions");
      }
    };

    startCamera();

    return () => {
      stopStream();
      ws.close();
      pc.close();
    };
  }, []);

  // ── MediaPipe pose detection ──────────────────────────────────────────────
  function startPose() {
    const v = vRef.current!;
    const c = cRef.current!;
    const ctx = c.getContext("2d")!;
    const win = window as any;

    const pose = new win.Pose({
      locateFile: (f: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });

    pose.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults((r: any) => {
      c.width = v.videoWidth || 640;
      c.height = v.videoHeight || 480;
      ctx.clearRect(0, 0, c.width, c.height);

      if (!r.poseLandmarks) {
        setStatus("No pose — adjust camera angle");
        return;
      }

      setStatus(conn ? "Connected — tracking" : "Tracking — connecting...");

      const lm = r.poseLandmarks;
      const W = c.width;
      const H = c.height;

      // Draw skeleton bones
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = 3;
      (
        [
          [7, 11],
          [8, 12],
          [11, 12],
          [11, 23],
          [12, 24],
          [23, 24],
        ] as [number, number][]
      ).forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
        ctx.stroke();
      });

      // Draw landmark dots
      ctx.fillStyle = "#a855f7";
      [7, 8, 11, 12, 23, 24].forEach((i) => {
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Send landmarks to laptop via WebRTC data channel
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(
          JSON.stringify({
            type: "side-landmarks",
            landmarks: lm,
            timestamp: Date.now(),
          }),
        );
      }
    });

    new win.Camera(v, {
      onFrame: async () => {
        await pose.send({ image: v });
      },
      width: 640,
      height: 480,
    }).start();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: "#0a0a1a",
        minHeight: "100vh",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        gap: "16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: "#7c3aed",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0" }}>
            PostureAI
          </div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>Side camera mode</div>
        </div>
      </div>

      {/* Status badge */}
      <div
        style={{
          padding: "6px 18px",
          borderRadius: 99,
          fontSize: 12,
          fontWeight: 600,
          background: conn ? "#064e3b" : "#1e1b4b",
          border: `1px solid ${conn ? "#10b981" : "#7c3aed"}`,
          color: conn ? "#10b981" : "#a855f7",
          letterSpacing: "0.03em",
        }}
      >
        {status}
      </div>

      {/* Camera feed */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #2a2a4a",
          background: "#111128",
          boxShadow: "0 0 24px #7c3aed33",
        }}
      >
        <video
          ref={vRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", display: "block" }}
        />
        <canvas
          ref={cRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>

      {/* Placement guide */}
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          background: "#111128",
          borderRadius: 12,
          padding: "16px 20px",
          border: "1px solid #2a2a4a",
          fontSize: 13,
          color: "#9ca3af",
          lineHeight: 2.2,
        }}
      >
        <p
          style={{
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: 8,
            fontSize: 12,
            letterSpacing: "0.08em",
          }}
        >
          PLACEMENT GUIDE
        </p>
        <p>→ Place phone upright on table edge</p>
        <p>→ Rear camera facing your left side</p>
        <p>→ Ear, shoulder and hip must be visible</p>
        <p>→ Sit 60–90 cm away from phone</p>
      </div>
    </div>
  );
}
