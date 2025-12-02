// student-app/src/components/VictoryScreen.jsx
import React from "react";
import Lottie from "lottie-react";
import celebrationAnimation from "../assets/celebration.json"; // adjust path if needed

function VictoryScreen({ onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        color: "white",
        textAlign: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <Lottie
        animationData={celebrationAnimation}
        style={{ width: "80%", maxWidth: 400 }}
        loop={false}
      />
      <h1 style={{ fontSize: "2.5rem", margin: "20px 0" }}>Victory!</h1>
      <p style={{ fontSize: "1.2rem" }}>Great job! Tap to continue.</p>
    </div>
  );
}

export default VictoryScreen;