import React from "react";
import { createRoot } from "react-dom/client";
import { AccountApp } from "./AccountApp";
import "./account.css";
import "./design-kit.css";
import "./workspace.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><AccountApp /></React.StrictMode>);
