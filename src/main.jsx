import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="boot-error">
          <h1>Kadi could not start</h1>
          <p>{this.state.error.message}</p>
        </main>
      );
    }

    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  const root = document.getElementById("root");
  if (root && !root.textContent.includes("Kadi could not start")) {
    root.innerHTML = `<main class="boot-error"><h1>Kadi could not start</h1><p>${event.message}</p></main>`;
  }
});

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
