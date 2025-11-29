// student-app/src/main.jsx
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./StudentApp.jsx";
import "./index.css";

// Motion permission request — must be inside a component
function MotionPermissionWrapper() {
  const [permissionAsked, setPermissionAsked] = React.useState(false);

  const requestPermission = () => {
    if (typeof DeviceMotionEvent.requestPermission === "function" && !permissionAsked) {
      DeviceMotionEvent.requestPermission()
        .then(state => {
          if (state === "granted") console.log("Motion granted");
        })
        .catch(console.error)
        .finally(() => setPermissionAsked(true));
    }
  };

  return (
    <div onClick={requestPermission} onTouchStart={requestPermission}>
      <App />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionPermissionWrapper />
  </React.StrictMode>
);