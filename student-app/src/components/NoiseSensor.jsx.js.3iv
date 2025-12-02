// student-app/src/components/NoiseSensor.jsx
import React, { useEffect, useState } from "react";

function NoiseSensor({ active, roomCode, socket, ignoreNoise }) {
  const [audioContext, setAudioContext] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [microphone, setMicrophone] = useState(null);
  const [javascriptNode, setJavascriptNode] = useState(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active || ignoreNoise) return;

    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const mic = context.createMediaStreamSource(stream);
        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        const jsNode = context.createScriptProcessor(1024, 1, 1);

        mic.connect(analyserNode);
        analyserNode.connect(jsNode);
        jsNode.connect(context.destination);

        jsNode.onaudioprocess = () => {
          const data = new Uint8Array(analyserNode.frequencyBinCount);
          analyserNode.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            sum += data[i];
          }
          const avg = sum / data.length;
          const clamped = Math.min(100, Math.floor(avg * 0.5)); // Scale to 0-100
          setLevel(clamped);

          socket.emit("noise:sample", { roomCode, level: clamped });
        };

        setAudioContext(context);
        setMicrophone(mic);
        setAnalyser(analyserNode);
        setJavascriptNode(jsNode);
      } catch (err) {
        console.error("NoiseSensor setup error:", err);
      }
    };

    setupAudio();

    return () => {
      if (javascriptNode) javascriptNode.disconnect();
      if (analyser) analyser.disconnect();
      if (microphone) microphone.disconnect();
      if (audioContext) audioContext.close();
    };
  }, [active, ignoreNoise, roomCode, socket]);

  return null; // Invisible component — no UI
}

export default NoiseSensor;