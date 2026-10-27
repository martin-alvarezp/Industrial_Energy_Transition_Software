import React from "react";
import ReactDOM from "react-dom/client";
import StudioApp from "./ui/StudioApp.jsx";
import "@fontsource-variable/figtree";
import "@fontsource-variable/inter";
import "leaflet/dist/leaflet.css";
import "./theme.css";
import "./ui/ui.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StudioApp />
  </React.StrictMode>
);
