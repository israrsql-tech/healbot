// import React from "react";
// import ReactDOM from "react-dom/client";
// import App from "./App";
// import { ThemeProvider } from "./ThemeProvider";

// ReactDOM.createRoot(document.getElementById("root")).render(
//   <ThemeProvider defaultTheme="rose">
//     <App />
//   </ThemeProvider>
// );



import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./ThemeProvider";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider defaultTheme="rose">
    <App />
  </ThemeProvider>
);

serviceWorkerRegistration.register();
