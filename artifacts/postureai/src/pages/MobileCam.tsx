import { useEffect, useRef, useState } from "react";

export default function MobileCam() {
  const vRef = useRef<HTMLVideoElement>(null);
  const cRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Starting rear camera...");
  const [conn, setConn] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/signal`);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const dc = pc.createDataChannel("landmarks");
    dcRef.current = dc;
    dc.onopen = () => { setConn(true); setStatus("Connected to laptop!"); };
    dc.onclose = () => { setConn(false); setStatus("Disconnected — refresh to retry"); };
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate, from: "mobile" }));
    };
    ws.onopen = async () => {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      ws.send(JSON.stringify({ type: "offer", sdp: o, from: "mobile" }));
    };
    ws.onmessage = async (msg) => {
      const d = JSON.parse(msg.data);
      if (d.from === "mobile") return;
      if (d.type === "answer") await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      else if (d.type === "candidate" && d.candidate) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { exact: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }))
      .then((stream) => {
        if (!vRef.current) return;
        vRef.current.srcObject = stream;
        setStatus("Camera ready — positioning...");
        startPose();
      })
      .catch(() => setStatus("Could not access rear camera"));
    return () => { ws.close(); pc.close(); };
  }, []);

  function startPose() {
    const v = vRef.current!;
    const c = cRef.current!;
    const ctx = c.getContext("2d")!;
    const win = window as any;
    const pose = new win.Pose({ locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults((r: any) => {
      c.width = v.videoWidth || 640;
      c.height = v.videoHeight || 480;
      ctx.clearRect(0, 0, c.width, c.height);
      if (!r.poseLandmarks) { setStatus("No pose — adjust camera"); return; }
      setStatus(conn ? "Connected — tracking" : "Tracking — connecting...");
      const lm = r.poseLandmarks;
      const W = c.width, H = c.height;
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = 3;
      [[7, 11], [8, 12], [11, 12], [11, 23], [12, 24], [23, 24]].forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
        ctx.stroke();
      });
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") dc.send(JSON.stringify({ type: "side-landmarks", landmarks: lm, timestamp: Date.now() }));
    });
    new win.Camera(v, { onFrame: async () => { await pose.send({ image: v }); }, width: 640, height: 480 }).start();
  }

  return (
    <div style={{ background: "#f8f9fb", minHeight: "100vh", fontFamily: "Inter,sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, background: "#2563eb", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1d23" }}>PostureAI</div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Side camera mode</div>
        </div>
      </div>
      <div style={{ padding: "6px 16px", borderRadius: 99, fontSize: 12, fontWeight: 500, background: conn ? "#d1fae5" : "#eff6ff", border: `1px solid ${conn ? "#a7f3d0" : "#bfdbfe"}`, color: conn ? "#065f46" : "#1d4ed8" }}>
        {status}
      </div>
      <div style={{ position: "relative", width: "100%", maxWidth: 400, borderRadius: 12, overflow: "hidden", border: "1px solid #e8eaed" }}>
        <video ref={vRef} autoPlay playsInline style={{ width: "100%", display: "block" }} />
        <canvas ref={cRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
      </div>
      <div style={{ maxWidth: 400, width: "100%", background: "white", borderRadius: 12, padding: 16, border: "1px solid #e8eaed", fontSize: 13, color: "#374151", lineHeight: 2 }}>
        <p style={{ fontWeight: 600, color: "#1a1d23", marginBottom: 8 }}>Placement guide</p>
        <p>→ Place phone upright on table edge</p>
        <p>→ Rear camera facing your left side</p>
        <p>→ Ear, shoulder and hip must be visible</p>
        <p>→ Sit 60–90cm away from phone</p>
      </div>
    </div>
  );
}
